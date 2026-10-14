-- ============================================================================
-- Ri-materializzazione default-libero al cambio date stagione
-- ============================================================================
--
-- Problema: `_materialize_default_libero()` viene invocata solo su INSERT
-- ombrellone e su (dis)assegnazione cliente. Estendendo la stagione (es.
-- 15/09 → 31/12) gli ombrelloni SENZA cliente stagionale non ricevono le righe
-- default-libero (`disponibilita stato='libero' cliente_id=NULL`) per i nuovi
-- giorni; restringendola restano righe default-libero fuori stagione.
--
-- Fix: trigger AFTER UPDATE OF data_inizio_stagione, data_fine_stagione su
-- `stabilimenti`:
--   a) per ogni ombrellone attivo senza cliente assegnato → PERFORM
--      _materialize_default_libero (idempotente, ON CONFLICT DO NOTHING,
--      rispetta mai_libero / chiusura_speciale).
--   b) DELETE delle sole righe default-libero FUTURE fuori dal nuovo range
--      (stato='libero' AND cliente_id IS NULL). Mai toccati sub_affittato né
--      righe con cliente_id valorizzato.
-- Audit per-riga soppresso via `audit.batch_tag` (l'UPDATE su stabilimenti
-- resta loggato dal trigger audit standard).
-- In coda: backfill una tantum su tutti gli stabilimenti.
-- ============================================================================

-- 0) Guard: lo schema di produzione deve avere ciò su cui ci appoggiamo -------
DO $$
BEGIN
  IF to_regprocedure('public._materialize_default_libero(uuid)') IS NULL THEN
    RAISE EXCEPTION 'public._materialize_default_libero(uuid) non esiste: migration annullata';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ombrelloni' AND column_name = 'attivo'
  ) THEN
    RAISE EXCEPTION 'colonna public.ombrelloni.attivo non esiste: migration annullata';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'clienti_stagionali' AND column_name = 'ombrellone_id'
  ) THEN
    RAISE EXCEPTION 'colonna public.clienti_stagionali.ombrellone_id non esiste: migration annullata';
  END IF;
END $$;

-- 1) Helper: riallinea default-libero di uno stabilimento alla stagione -------
CREATE OR REPLACE FUNCTION public._riallinea_default_libero_stagione(p_stabilimento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inizio date;
  v_fine   date;
  v_omb_id uuid;
BEGIN
  SELECT data_inizio_stagione, data_fine_stagione
    INTO v_inizio, v_fine
    FROM public.stabilimenti
   WHERE id = p_stabilimento_id;

  IF v_inizio IS NULL OR v_fine IS NULL THEN
    RETURN;
  END IF;

  -- b) Stagione ristretta: rimuovi default-libero future fuori range.
  DELETE FROM public.disponibilita d
   USING public.ombrelloni o
   WHERE d.ombrellone_id = o.id
     AND o.stabilimento_id = p_stabilimento_id
     AND d.cliente_id IS NULL
     AND d.stato = 'libero'
     AND d.data >= current_date
     AND (d.data < v_inizio OR d.data > v_fine);

  -- a) Stagione estesa: materializza i giorni mancanti.
  FOR v_omb_id IN
    SELECT o.id
      FROM public.ombrelloni o
     WHERE o.stabilimento_id = p_stabilimento_id
       AND o.attivo = true
       AND NOT EXISTS (
         SELECT 1 FROM public.clienti_stagionali c
          WHERE c.ombrellone_id = o.id
       )
  LOOP
    PERFORM public._materialize_default_libero(v_omb_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._riallinea_default_libero_stagione(uuid) FROM PUBLIC, anon, authenticated;

-- 2) Trigger AFTER UPDATE OF date stagione su stabilimenti ---------------------
CREATE OR REPLACE FUNCTION public._on_stagione_dates_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_tag text;
BEGIN
  v_prev_tag := current_setting('audit.batch_tag', true);
  PERFORM set_config('audit.batch_tag', COALESCE(NULLIF(v_prev_tag,''),'stagione_rematerialize'), true);
  PERFORM public._riallinea_default_libero_stagione(NEW.id);
  PERFORM set_config('audit.batch_tag', COALESCE(v_prev_tag,''), true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stabilimenti_stagione_rematerialize_after_update ON public.stabilimenti;
CREATE TRIGGER stabilimenti_stagione_rematerialize_after_update
AFTER UPDATE OF data_inizio_stagione, data_fine_stagione ON public.stabilimenti
FOR EACH ROW
WHEN (OLD.data_inizio_stagione IS DISTINCT FROM NEW.data_inizio_stagione
   OR OLD.data_fine_stagione   IS DISTINCT FROM NEW.data_fine_stagione)
EXECUTE FUNCTION public._on_stagione_dates_changed();

-- 3) Backfill una tantum ----------------------------------------------------
-- Sistema gli stabilimenti che hanno già modificato la stagione prima di
-- questo trigger. Idempotente.
DO $$
DECLARE
  v_stab_id uuid;
  v_prev_tag text;
BEGIN
  v_prev_tag := current_setting('audit.batch_tag', true);
  PERFORM set_config('audit.batch_tag', 'backfill_stagione_rematerialize', true);
  FOR v_stab_id IN SELECT id FROM public.stabilimenti LOOP
    PERFORM public._riallinea_default_libero_stagione(v_stab_id);
  END LOOP;
  PERFORM set_config('audit.batch_tag', COALESCE(v_prev_tag,''), true);
END $$;
