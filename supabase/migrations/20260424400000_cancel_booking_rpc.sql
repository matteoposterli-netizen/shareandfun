-- Atomic cancellation of a sub-rental booking via a SECURITY DEFINER RPC.
--
-- The previous client-side flow (js/manager.js → confirmCancelBooking) issued
-- four separate statements in sequence (one UPDATE on disponibilita, two
-- INSERTs into transazioni, one UPDATE on clienti_stagionali). In production
-- the final INSERT started failing with:
--   new row violates row-level security policy for table "transazioni"
-- even for the stabilimento owner. The exact trigger is unclear (session
-- staleness, RLS drift, etc.), but wrapping the whole flow in a
-- SECURITY DEFINER function with an explicit ownership check is immune to
-- both RLS oddities and partial-failure states.
--
-- The function verifies that the caller owns the stabilimento(s) implied by
-- the disponibilita ids; it rejects calls that span multiple stabilimenti or
-- where the caller is not the owner.

CREATE OR REPLACE FUNCTION public.cancel_booking(p_disp_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid        uuid := (SELECT auth.uid());
  v_stab_ids   uuid[];
  v_stab_id    uuid;
  v_item       record;
  v_omb        record;
  v_date_fmt   text;
  v_name_suf   text;
  v_omb_label  text;
  v_omb_short  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  IF p_disp_ids IS NULL OR array_length(p_disp_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT o.stabilimento_id
    FROM public.disponibilita d
    JOIN public.ombrelloni   o ON o.id = d.ombrellone_id
    WHERE d.id = ANY(p_disp_ids)
  ) INTO v_stab_ids;

  IF array_length(v_stab_ids, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Disponibilità non valide o su stabilimenti diversi';
  END IF;

  v_stab_id := v_stab_ids[1];

  IF NOT EXISTS (
    SELECT 1 FROM public.stabilimenti
    WHERE id = v_stab_id AND proprietario_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  UPDATE public.disponibilita
     SET stato = 'libero', nome_prenotazione = NULL
   WHERE id = ANY(p_disp_ids);

  FOR v_item IN
    SELECT d.id, d.ombrellone_id, d.cliente_id, d.data, d.nome_prenotazione
    FROM public.disponibilita d
    WHERE d.id = ANY(p_disp_ids)
  LOOP
    SELECT fila, numero, credito_giornaliero INTO v_omb
    FROM public.ombrelloni WHERE id = v_item.ombrellone_id;

    v_date_fmt := to_char(v_item.data, 'DD/MM/YYYY');
    v_name_suf := CASE
      WHEN v_item.nome_prenotazione IS NOT NULL
        AND btrim(v_item.nome_prenotazione) <> ''
      THEN ' (prenotazione "' || v_item.nome_prenotazione || '")'
      ELSE ''
    END;

    IF v_omb.fila IS NOT NULL THEN
      v_omb_short := v_omb.fila || v_omb.numero;
      v_omb_label := 'Ombrellone ' || v_omb_short;
    ELSE
      v_omb_short := NULL;
      v_omb_label := 'Ombrellone rimosso';
    END IF;

    INSERT INTO public.transazioni
      (stabilimento_id, ombrellone_id, cliente_id, tipo, importo, nota)
    VALUES (
      v_stab_id,
      v_item.ombrellone_id,
      v_item.cliente_id,
      'sub_affitto_annullato',
      v_omb.credito_giornaliero,
      v_omb_label || ' — sub-affitto annullato per ' || v_date_fmt || v_name_suf
    );

    IF v_item.cliente_id IS NOT NULL
       AND COALESCE(v_omb.credito_giornaliero, 0) > 0 THEN
      INSERT INTO public.transazioni
        (stabilimento_id, ombrellone_id, cliente_id, tipo, importo, nota)
      VALUES (
        v_stab_id,
        v_item.ombrellone_id,
        v_item.cliente_id,
        'credito_revocato',
        v_omb.credito_giornaliero,
        'Credito revocato per annullamento sub-affitto'
          || CASE WHEN v_omb_short IS NOT NULL THEN ' ' || v_omb_short ELSE '' END
          || ' del ' || v_date_fmt || v_name_suf
      );

      UPDATE public.clienti_stagionali
         SET credito_saldo = COALESCE(credito_saldo, 0) - v_omb.credito_giornaliero
       WHERE id = v_item.cliente_id;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_booking(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid[]) TO authenticated;
