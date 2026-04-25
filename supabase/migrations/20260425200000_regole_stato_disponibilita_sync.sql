-- Sincronizza la tabella `disponibilita` con i nuovi tipi di regola
-- (`sempre_libero`, `mai_libero`) creati via RPC `crea_regola_stato`.
--
-- Bug: la versione precedente dell'RPC inseriva soltanto la riga in
-- `regole_stato_ombrelloni` (più la notifica aggregata). Per
-- `chiusura_speciale` venivano comunque annullati i sub-affitti, ma per
-- `sempre_libero` / `mai_libero` non veniva toccata la tabella
-- `disponibilita`. Risultato lato cliente:
--
--   • sempre_libero: il giorno restava grigio "Non modificabile" invece
--     di apparire verde "Dichiarato libero" — perché la riga `libero`
--     non esisteva in DB.
--   • mai_libero: se il cliente aveva già dichiarato libero un giorno
--     in quel range, la riga `libero` restava in DB e (vedi
--     `.cal-day.restricted.free` in `styles.css`) il giorno continuava
--     ad essere verde, contraddicendo la regola.
--
-- Fix:
--   • sempre_libero  → upsert disponibilita libero per ogni
--                      (ombrellone × giorno) del range, ignorando
--                      conflitti per non sovrascrivere `sub_affittato`.
--   • mai_libero     → DELETE delle disponibilita `libero` esistenti nel
--                      range. I `sub_affittato` non vengono toccati
--                      (semantica "bagno aperto, gestione manuale").
--
-- Le righe esistenti di `regole_stato_ombrelloni` vengono ricalibrate da
-- un backfill in coda (idempotente: l'INSERT salta i conflitti, il
-- DELETE lavora solo sulle righe `libero`).
--
-- L'eliminazione di una regola NON ripristina lo stato precedente
-- (consistente con la semantica esistente di `chiusura_speciale`).

CREATE OR REPLACE FUNCTION public.crea_regola_stato(
  p_stabilimento_id uuid,
  p_tipo            text,
  p_data_da         date,
  p_data_a          date,
  p_nota            text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid       uuid := (SELECT auth.uid());
  v_id        uuid;
  v_disp_ids  uuid[];
  v_label     text;
  v_range_fmt text;
  v_cs        record;
  v_nota_clean text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stabilimenti
    WHERE id = p_stabilimento_id AND proprietario_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  IF p_tipo NOT IN ('chiusura_speciale','sempre_libero','mai_libero') THEN
    RAISE EXCEPTION 'Tipo regola non valido: %', p_tipo;
  END IF;

  IF p_data_a < p_data_da THEN
    RAISE EXCEPTION 'Data fine precedente alla data inizio';
  END IF;

  INSERT INTO public.regole_stato_ombrelloni
    (stabilimento_id, tipo, data_da, data_a, nota, created_by)
  VALUES
    (p_stabilimento_id, p_tipo, p_data_da, p_data_a, p_nota, v_uid)
  RETURNING id INTO v_id;

  -- chiusura_speciale: annulla i sub-affitti esistenti nel range.
  IF p_tipo = 'chiusura_speciale' THEN
    SELECT ARRAY(
      SELECT d.id
      FROM public.disponibilita d
      JOIN public.ombrelloni o ON o.id = d.ombrellone_id
      WHERE o.stabilimento_id = p_stabilimento_id
        AND d.data BETWEEN p_data_da AND p_data_a
        AND d.stato = 'sub_affittato'
    ) INTO v_disp_ids;

    IF array_length(v_disp_ids, 1) IS NOT NULL THEN
      PERFORM public.cancel_booking(v_disp_ids);
    END IF;

  -- sempre_libero: forza disponibilita `libero` per ogni ombrellone
  -- dello stabilimento × ogni giorno del range. ON CONFLICT DO NOTHING
  -- preserva eventuali `libero` o `sub_affittato` già presenti.
  ELSIF p_tipo = 'sempre_libero' THEN
    INSERT INTO public.disponibilita (ombrellone_id, cliente_id, data, stato)
    SELECT
      o.id,
      (SELECT cs.id
         FROM public.clienti_stagionali cs
        WHERE cs.ombrellone_id = o.id
          AND cs.rifiutato IS NOT TRUE
        LIMIT 1),
      gs::date,
      'libero'
    FROM public.ombrelloni o
    CROSS JOIN generate_series(p_data_da, p_data_a, interval '1 day') AS gs
    WHERE o.stabilimento_id = p_stabilimento_id
    ON CONFLICT (ombrellone_id, data) DO NOTHING;

  -- mai_libero: rimuovi le disponibilita `libero` preesistenti nel
  -- range. I `sub_affittato` restano intatti (bagno aperto).
  ELSIF p_tipo = 'mai_libero' THEN
    DELETE FROM public.disponibilita d
    USING public.ombrelloni o
    WHERE d.ombrellone_id = o.id
      AND o.stabilimento_id = p_stabilimento_id
      AND d.data BETWEEN p_data_da AND p_data_a
      AND d.stato = 'libero';
  END IF;

  -- Notifica aggregata ai clienti stagionali.
  v_label := CASE p_tipo
    WHEN 'chiusura_speciale' THEN 'Chiusura speciale'
    WHEN 'sempre_libero'     THEN 'Sempre subaffittabile'
    WHEN 'mai_libero'        THEN 'Mai subaffittabile'
  END;

  IF p_data_da = p_data_a THEN
    v_range_fmt := to_char(p_data_da, 'DD/MM/YYYY');
  ELSE
    v_range_fmt := 'dal ' || to_char(p_data_da, 'DD/MM/YYYY')
                || ' al '  || to_char(p_data_a,  'DD/MM/YYYY');
  END IF;

  v_nota_clean := NULLIF(btrim(COALESCE(p_nota,'')), '');

  FOR v_cs IN
    SELECT id, ombrellone_id
    FROM public.clienti_stagionali
    WHERE stabilimento_id = p_stabilimento_id
      AND ombrellone_id IS NOT NULL
  LOOP
    INSERT INTO public.transazioni
      (stabilimento_id, ombrellone_id, cliente_id, tipo, importo, nota)
    VALUES (
      p_stabilimento_id,
      v_cs.ombrellone_id,
      v_cs.id,
      'regola_forzata_aggiunta',
      0,
      v_label || ' impostata dal proprietario · ' || v_range_fmt
        || COALESCE(' — ' || v_nota_clean, '')
    );
  END LOOP;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crea_regola_stato(uuid, text, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crea_regola_stato(uuid, text, date, date, text) TO authenticated;

-- ============================================================
-- Backfill: applica gli effetti collaterali alle regole già create
-- prima di questo fix. Idempotente: l'INSERT salta i conflitti
-- (preserva `libero`/`sub_affittato` esistenti), il DELETE agisce
-- solo sulle righe `libero` (i `sub_affittato` non vengono toccati).
-- ============================================================

DO $$
DECLARE
  v_rule record;
BEGIN
  FOR v_rule IN
    SELECT id, stabilimento_id, tipo, data_da, data_a
      FROM public.regole_stato_ombrelloni
     WHERE tipo IN ('sempre_libero','mai_libero')
  LOOP
    IF v_rule.tipo = 'sempre_libero' THEN
      INSERT INTO public.disponibilita (ombrellone_id, cliente_id, data, stato)
      SELECT
        o.id,
        (SELECT cs.id
           FROM public.clienti_stagionali cs
          WHERE cs.ombrellone_id = o.id
            AND cs.rifiutato IS NOT TRUE
          LIMIT 1),
        gs::date,
        'libero'
      FROM public.ombrelloni o
      CROSS JOIN generate_series(v_rule.data_da, v_rule.data_a, interval '1 day') AS gs
      WHERE o.stabilimento_id = v_rule.stabilimento_id
      ON CONFLICT (ombrellone_id, data) DO NOTHING;
    ELSE
      DELETE FROM public.disponibilita d
      USING public.ombrelloni o
      WHERE d.ombrellone_id = o.id
        AND o.stabilimento_id = v_rule.stabilimento_id
        AND d.data BETWEEN v_rule.data_da AND v_rule.data_a
        AND d.stato = 'libero';
    END IF;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.crea_regola_stato(uuid, text, date, date, text) IS
  'Crea una regola di stato. Side-effects per tipo: chiusura_speciale → annulla sub-affitti nel range; sempre_libero → upsert disponibilita libero (skip conflicts); mai_libero → DELETE disponibilita libero (preserva sub_affittato). Emette una transazione regola_forzata_aggiunta aggregata per cliente con ombrellone assegnato.';
