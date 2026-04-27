-- ============================================================================
-- Default-libero per ombrelloni senza cliente stagionale assegnato
-- ============================================================================
--
-- Convenzione semantica (NO schema change su `disponibilita.stato`):
--   stato='libero'       AND cliente_id IS NULL  → "default-libero" (ombrellone
--                                                  senza cliente assegnato,
--                                                  subaffittabile dal proprietario;
--                                                  nessun coin generato)
--   stato='libero'       AND cliente_id NOT NULL → libero dichiarato dallo
--                                                  stagionale assegnato
--   stato='sub_affittato' AND cliente_id IS NULL  → sub-affitto su ombrellone
--                                                  senza cliente: NO accredito
--   stato='sub_affittato' AND cliente_id NOT NULL → sub-affitto con accredito
--                                                  al cliente assegnato
--
-- Effetti:
--  * Alla creazione di un ombrellone, materializza righe `libero cliente_id=NULL`
--    per (max(today, data_inizio_stagione)..data_fine_stagione), saltando i
--    giorni con regole `mai_libero`/`chiusura_speciale`.
--  * All'assegnazione cliente↔ombrellone (UPDATE clienti_stagionali.ombrellone_id):
--      - i sub-affitti futuri (data >= today) con cliente_id IS NULL su
--        quell'ombrellone vengono promossi a cliente_id=<nuovo cliente>;
--        per ciascuno si genera una transazione `credito_ricevuto` e si
--        aggiorna `clienti_stagionali.credito_saldo`.
--      - le righe default-libero future vengono cancellate (l'ombrellone
--        non è più "default": è del cliente, che decide se renderle libere).
--      - i sub-affitti passati restano cliente_id=NULL (no backfill retroattivo).
--  * Alla disassegnazione (UPDATE ombrellone_id → NULL, cancellazione cliente,
--    o riassegnazione A→B):
--      - i sub-affitti futuri con cliente_id=A restano cliente_id=A (storico
--        immutabile, A si tiene i coin).
--      - le righe `libero` future con cliente_id=A vengono "rilasciate" a
--        cliente_id=NULL (tornano default-libero).
--      - si materializzano default-libero per i giorni futuri scoperti.
--  * Le regole forzate (`mai_libero`, `chiusura_speciale`, `sempre_libero`)
--    vincono sempre: la materializzazione default-libero filtra i giorni
--    coperti da regole bloccanti.
--
-- FK `disponibilita.cliente_id`: passa da ON DELETE CASCADE a ON DELETE SET NULL,
-- coerente con la semantica nuova (cancellare un cliente non distrugge lo
-- storico delle giornate, le righe diventano cliente_id=NULL).
-- ============================================================================

-- 1) FK disponibilita.cliente_id: CASCADE → SET NULL ----------------------------
ALTER TABLE public.disponibilita
  DROP CONSTRAINT IF EXISTS disponibilita_cliente_id_fkey;
ALTER TABLE public.disponibilita
  ADD CONSTRAINT disponibilita_cliente_id_fkey
    FOREIGN KEY (cliente_id) REFERENCES public.clienti_stagionali(id) ON DELETE SET NULL;

-- 2) Helper: materializza default-libero per un ombrellone ----------------------
CREATE OR REPLACE FUNCTION public._materialize_default_libero(p_ombrellone_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stab_id uuid;
  v_data_da date;
  v_data_a  date;
BEGIN
  SELECT o.stabilimento_id, GREATEST(current_date, s.data_inizio_stagione), s.data_fine_stagione
    INTO v_stab_id, v_data_da, v_data_a
    FROM public.ombrelloni o
    JOIN public.stabilimenti s ON s.id = o.stabilimento_id
   WHERE o.id = p_ombrellone_id;

  IF v_stab_id IS NULL OR v_data_da IS NULL OR v_data_a IS NULL OR v_data_da > v_data_a THEN
    RETURN;
  END IF;

  INSERT INTO public.disponibilita (ombrellone_id, cliente_id, data, stato)
  SELECT p_ombrellone_id, NULL, d::date, 'libero'
    FROM generate_series(v_data_da, v_data_a, interval '1 day') d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.regole_stato_ombrelloni r
      WHERE r.stabilimento_id = v_stab_id
        AND r.tipo IN ('mai_libero','chiusura_speciale')
        AND d::date BETWEEN r.data_da AND r.data_a
   )
  ON CONFLICT (ombrellone_id, data) DO NOTHING;
END;
$$;

-- 3) Helper: applica assegnazione cliente → ombrellone --------------------------
CREATE OR REPLACE FUNCTION public._assegna_cliente_a_ombrellone(
  p_cliente_id uuid,
  p_ombrellone_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stab_id uuid;
  v_credito numeric;
  v_today date := current_date;
  v_promoted record;
  v_promoted_ids uuid[] := ARRAY[]::uuid[];
  v_total numeric := 0;
BEGIN
  SELECT stabilimento_id, credito_giornaliero
    INTO v_stab_id, v_credito
    FROM public.ombrelloni
   WHERE id = p_ombrellone_id;

  IF v_stab_id IS NULL THEN
    RETURN;
  END IF;

  -- Promuovi sub-affittati futuri con cliente_id IS NULL al nuovo cliente,
  -- accumulando id e importi per generare credito_ricevuto.
  FOR v_promoted IN
    SELECT id, data
      FROM public.disponibilita
     WHERE ombrellone_id = p_ombrellone_id
       AND data >= v_today
       AND stato = 'sub_affittato'
       AND cliente_id IS NULL
     FOR UPDATE
  LOOP
    UPDATE public.disponibilita
       SET cliente_id = p_cliente_id
     WHERE id = v_promoted.id;

    INSERT INTO public.transazioni
      (stabilimento_id, ombrellone_id, cliente_id, tipo, importo, nota)
    VALUES
      (v_stab_id, p_ombrellone_id, p_cliente_id, 'credito_ricevuto', v_credito,
       'Credito accreditato all''assegnazione del cliente · sub-affitto del ' ||
       to_char(v_promoted.data, 'DD/MM/YYYY'));

    v_total := v_total + v_credito;
    v_promoted_ids := v_promoted_ids || v_promoted.id;
  END LOOP;

  IF v_total > 0 THEN
    UPDATE public.clienti_stagionali
       SET credito_saldo = COALESCE(credito_saldo, 0) + v_total
     WHERE id = p_cliente_id;
  END IF;

  -- Cancella le righe default-libero future (cliente_id IS NULL stato='libero'):
  -- da qui in poi l'ombrellone è del cliente, sarà lui a decidere quando renderle libere.
  DELETE FROM public.disponibilita
   WHERE ombrellone_id = p_ombrellone_id
     AND data >= v_today
     AND stato = 'libero'
     AND cliente_id IS NULL;
END;
$$;

-- 4) Helper: rilascia ombrellone ↔ cliente (disassegnazione) --------------------
CREATE OR REPLACE FUNCTION public._rilascia_cliente_da_ombrellone(
  p_cliente_id uuid,
  p_ombrellone_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := current_date;
BEGIN
  -- Le righe libero future con cliente_id = p_cliente_id tornano default-libero
  -- (lo stagionale aveva dichiarato la giornata; ora che non è più assegnato,
  -- la giornata torna disponibile come default).
  UPDATE public.disponibilita
     SET cliente_id = NULL
   WHERE ombrellone_id = p_ombrellone_id
     AND data >= v_today
     AND stato = 'libero'
     AND cliente_id = p_cliente_id;

  -- I sub_affittati futuri con cliente_id = p_cliente_id NON vengono toccati
  -- (storico immutabile: A si tiene i coin già accreditati).

  -- Materializza default-libero per i giorni futuri non già coperti.
  PERFORM public._materialize_default_libero(p_ombrellone_id);
END;
$$;

-- 5) Trigger AFTER INSERT su `ombrelloni` → materializza default-libero ---------
CREATE OR REPLACE FUNCTION public._on_ombrellone_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_tag text;
BEGIN
  v_prev_tag := current_setting('audit.batch_tag', true);
  PERFORM set_config('audit.batch_tag', COALESCE(NULLIF(v_prev_tag,''),'materialize_default_libero'), true);
  PERFORM public._materialize_default_libero(NEW.id);
  PERFORM set_config('audit.batch_tag', COALESCE(v_prev_tag,''), true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ombrelloni_default_libero_after_insert ON public.ombrelloni;
CREATE TRIGGER ombrelloni_default_libero_after_insert
AFTER INSERT ON public.ombrelloni
FOR EACH ROW EXECUTE FUNCTION public._on_ombrellone_inserted();

-- 6) Trigger AFTER INSERT/UPDATE/DELETE su `clienti_stagionali` -----------------
CREATE OR REPLACE FUNCTION public._on_cliente_assignment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_omb uuid;
  v_new_omb uuid;
  v_cliente_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_old_omb := NULL;
    v_new_omb := NEW.ombrellone_id;
    v_cliente_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_old_omb := OLD.ombrellone_id;
    v_new_omb := NULL;
    v_cliente_id := OLD.id;
  ELSE
    v_old_omb := OLD.ombrellone_id;
    v_new_omb := NEW.ombrellone_id;
    v_cliente_id := NEW.id;
  END IF;

  IF v_old_omb IS NOT DISTINCT FROM v_new_omb THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_old_omb IS NOT NULL THEN
    -- Per il DELETE, le FK ON DELETE SET NULL sulle disponibilita hanno già
    -- portato cliente_id=NULL: la _rilascia... non trova righe da rilasciare
    -- (cliente_id = v_cliente_id non matcha più), però materializza
    -- comunque le default-libero. Va bene.
    PERFORM public._rilascia_cliente_da_ombrellone(v_cliente_id, v_old_omb);
  END IF;

  IF v_new_omb IS NOT NULL THEN
    PERFORM public._assegna_cliente_a_ombrellone(v_cliente_id, v_new_omb);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS clienti_assignment_change_after ON public.clienti_stagionali;
CREATE TRIGGER clienti_assignment_change_after
AFTER INSERT OR UPDATE OR DELETE ON public.clienti_stagionali
FOR EACH ROW EXECUTE FUNCTION public._on_cliente_assignment_change();

-- 7) Backfill produzione --------------------------------------------------------
-- Materializza default-libero per ogni ombrellone esistente che NON ha cliente
-- assegnato, per i giorni futuri della stagione corrente. Idempotente.
DO $$
DECLARE
  v_omb_id uuid;
  v_prev_tag text;
BEGIN
  v_prev_tag := current_setting('audit.batch_tag', true);
  PERFORM set_config('audit.batch_tag', 'backfill_default_libero', true);
  FOR v_omb_id IN
    SELECT o.id
      FROM public.ombrelloni o
     WHERE NOT EXISTS (
       SELECT 1 FROM public.clienti_stagionali c
        WHERE c.ombrellone_id = o.id
     )
  LOOP
    PERFORM public._materialize_default_libero(v_omb_id);
  END LOOP;
  PERFORM set_config('audit.batch_tag', COALESCE(v_prev_tag,''), true);
END $$;

-- 8) Grant RPC -----------------------------------------------------------------
-- Le funzioni sono SECURITY DEFINER. Sono chiamate solo dai trigger interni
-- (non dal client). Nessun GRANT esplicito a anon/authenticated.
