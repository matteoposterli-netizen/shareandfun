-- Aggiunge colonna attivo agli ombrelloni
ALTER TABLE public.ombrelloni
  ADD COLUMN IF NOT EXISTS attivo boolean NOT NULL DEFAULT true;

-- RPC: disattiva ombrellone (cancella disponibilità future, imposta attivo=false)
-- Restituisce JSONB con { sub_affitti_futuri: [ {id, data, nome_prenotazione} ] }
-- che il frontend mostra nel warning prima della conferma.
CREATE OR REPLACE FUNCTION public.disattiva_ombrellone(p_ombrellone_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stab_id uuid;
  v_sub_futuri jsonb;
BEGIN
  -- Verifica che l'ombrellone appartenga allo stabilimento del chiamante
  SELECT stabilimento_id INTO v_stab_id
    FROM public.ombrelloni
   WHERE id = p_ombrellone_id
     AND stabilimento_id IN (
       SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid())
     );
  IF v_stab_id IS NULL THEN
    RAISE EXCEPTION 'Ombrellone non trovato o accesso non autorizzato';
  END IF;

  -- Raccoglie sub-affitti futuri per il warning
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'data', data,
    'nome_prenotazione', nome_prenotazione
  ) ORDER BY data)
  INTO v_sub_futuri
  FROM public.disponibilita
  WHERE ombrellone_id = p_ombrellone_id
    AND stato = 'sub_affittato'
    AND data >= current_date;

  -- Cancella tutte le disponibilità future (libero + sub_affittato)
  DELETE FROM public.disponibilita
  WHERE ombrellone_id = p_ombrellone_id
    AND data >= current_date;

  -- Imposta non attivo
  UPDATE public.ombrelloni SET attivo = false WHERE id = p_ombrellone_id;

  RETURN jsonb_build_object(
    'sub_affitti_cancellati', COALESCE(v_sub_futuri, '[]'::jsonb)
  );
END;
$$;

-- RPC: riattiva ombrellone (imposta attivo=true, nessuna disponibilità creata)
CREATE OR REPLACE FUNCTION public.riattiva_ombrellone(p_ombrellone_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ombrelloni SET attivo = true
  WHERE id = p_ombrellone_id
    AND stabilimento_id IN (
      SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid())
    );
END;
$$;

-- RPC: disattiva ombrelloni in massa
CREATE OR REPLACE FUNCTION public.disattiva_ombrelloni_bulk(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_oid uuid;
  v_risultati jsonb := '[]'::jsonb;
  v_item jsonb;
BEGIN
  FOREACH v_oid IN ARRAY p_ids LOOP
    BEGIN
      SELECT public.disattiva_ombrellone(v_oid) INTO v_item;
      v_risultati := v_risultati || jsonb_build_array(
        jsonb_build_object('ombrellone_id', v_oid, 'ok', true, 'data', v_item)
      );
    EXCEPTION WHEN OTHERS THEN
      v_risultati := v_risultati || jsonb_build_array(
        jsonb_build_object('ombrellone_id', v_oid, 'ok', false, 'error', SQLERRM)
      );
    END;
  END LOOP;
  RETURN v_risultati;
END;
$$;
