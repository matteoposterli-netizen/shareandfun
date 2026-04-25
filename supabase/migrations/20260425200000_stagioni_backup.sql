-- ============================================================
-- Reset stagione + backup ripristinabile
-- ============================================================
-- Aggiunge:
--   * Tabella `stagioni_backup` per snapshot JSON dello stato pre-reset.
--   * RPC `crea_backup_stagione`        — snapshot ad-hoc o auto-pre-reset.
--   * RPC `reset_stagione`              — backup automatico + cancellazioni.
--   * RPC `ripristina_backup`           — backup pre-restore + DELETE corrente
--                                         + RE-INSERT da payload.
--   * Estensione dei CHECK su `audit_log.entity_type` / `audit_log.action` e
--     dell'allowlist in `audit_log_write` per gli eventi
--     `backup_stagione` / `create_backup` / `reset` / `restore`.
--   * FIFO cap di 10 backup per stabilimento.
--
-- Note:
--   * Le scritture in `stagioni_backup` passano sempre dalle RPC
--     SECURITY DEFINER: niente policy INSERT/UPDATE/DELETE per il
--     proprietario, ma una SELECT che vede solo i propri backup.
--   * Le RPC settano `audit.batch_tag` per sopprimere il rumore di N righe
--     audit_log generate dai trigger durante DELETE/INSERT massivi.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stagioni_backup (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stabilimento_id uuid NOT NULL REFERENCES public.stabilimenti(id) ON DELETE CASCADE,
  etichetta       text,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stagioni_backup_stab_created
  ON public.stagioni_backup (stabilimento_id, created_at DESC);

ALTER TABLE public.stagioni_backup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stagioni_backup_select_owner ON public.stagioni_backup;
DROP POLICY IF EXISTS stagioni_backup_admin_all   ON public.stagioni_backup;

CREATE POLICY stagioni_backup_select_owner ON public.stagioni_backup
  FOR SELECT USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );

CREATE POLICY stagioni_backup_admin_all ON public.stagioni_backup
  FOR ALL USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

-- ============================================================
-- Estendo i CHECK di audit_log per includere gli eventi backup/reset/restore.
-- Preserva i valori già introdotti da migrazioni precedenti
-- (es. 'regola_stato' della migration regole_stato_ombrelloni).
-- ============================================================

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type = ANY (ARRAY[
    'transazione','disponibilita','cliente_stagionale','ombrellone',
    'stabilimento','profile','email','auth','import',
    'regola_stato','backup_stagione'
  ]));

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check
  CHECK (action = ANY (ARRAY[
    'insert','update','delete','login','email_sent','import_batch',
    'create_backup','reset','restore'
  ]));

-- Aggiorno audit_log_write per accettare i nuovi entity_type / action
CREATE OR REPLACE FUNCTION public.audit_log_write(
  p_stabilimento_id uuid,
  p_entity_type     text,
  p_action          text,
  p_description     text,
  p_entity_id       uuid DEFAULT NULL,
  p_metadata        jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_actor  record;
  v_id     uuid;
BEGIN
  IF p_stabilimento_id IS NULL THEN
    RAISE EXCEPTION 'stabilimento_id obbligatorio';
  END IF;
  IF p_entity_type NOT IN ('email','auth','import','backup_stagione') THEN
    RAISE EXCEPTION 'entity_type non valido per audit_log_write: %', p_entity_type;
  END IF;
  IF p_action NOT IN ('login','email_sent','import_batch','create_backup','reset','restore') THEN
    RAISE EXCEPTION 'action non valida per audit_log_write: %', p_action;
  END IF;

  IF v_uid IS NOT NULL
     AND NOT public.is_admin(v_uid)
     AND NOT EXISTS (SELECT 1 FROM public.stabilimenti
                     WHERE id = p_stabilimento_id AND proprietario_id = v_uid) THEN
    RAISE EXCEPTION 'Non autorizzato a scrivere log per questo stabilimento' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_actor FROM public._audit_current_actor();

  INSERT INTO public.audit_log (
    stabilimento_id, actor_type, actor_id, actor_label,
    entity_type, entity_id, action, after, description
  ) VALUES (
    p_stabilimento_id, v_actor.actor_type, v_actor.actor_id, v_actor.actor_label,
    p_entity_type, p_entity_id, p_action, p_metadata, p_description
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ============================================================
-- RPC: crea_backup_stagione (snapshot completo)
-- ============================================================

CREATE OR REPLACE FUNCTION public.crea_backup_stagione(
  p_stabilimento_id uuid,
  p_etichetta       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_id      uuid;
  v_payload jsonb;
  v_count   int;
BEGIN
  IF p_stabilimento_id IS NULL THEN
    RAISE EXCEPTION 'stabilimento_id obbligatorio';
  END IF;
  IF v_uid IS NOT NULL
     AND NOT public.is_admin(v_uid)
     AND NOT EXISTS (SELECT 1 FROM public.stabilimenti
                     WHERE id = p_stabilimento_id AND proprietario_id = v_uid) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'created_at', now(),
    'schema_version', 1,
    'stabilimento', (
      SELECT to_jsonb(s) FROM public.stabilimenti s WHERE s.id = p_stabilimento_id
    ),
    'ombrelloni', COALESCE((
      SELECT jsonb_agg(to_jsonb(o)) FROM public.ombrelloni o
      WHERE o.stabilimento_id = p_stabilimento_id
    ), '[]'::jsonb),
    'clienti_stagionali', COALESCE((
      SELECT jsonb_agg(to_jsonb(c)) FROM public.clienti_stagionali c
      WHERE c.stabilimento_id = p_stabilimento_id
    ), '[]'::jsonb),
    'disponibilita', COALESCE((
      SELECT jsonb_agg(to_jsonb(d))
      FROM public.disponibilita d
      JOIN public.ombrelloni o ON o.id = d.ombrellone_id
      WHERE o.stabilimento_id = p_stabilimento_id
    ), '[]'::jsonb),
    'transazioni', COALESCE((
      SELECT jsonb_agg(to_jsonb(t)) FROM public.transazioni t
      WHERE t.stabilimento_id = p_stabilimento_id
    ), '[]'::jsonb)
  ) INTO v_payload;

  INSERT INTO public.stagioni_backup (stabilimento_id, etichetta, payload)
  VALUES (p_stabilimento_id, p_etichetta, v_payload)
  RETURNING id INTO v_id;

  -- FIFO: keep only 10 most recent
  SELECT count(*) INTO v_count
    FROM public.stagioni_backup
   WHERE stabilimento_id = p_stabilimento_id;
  IF v_count > 10 THEN
    DELETE FROM public.stagioni_backup
     WHERE id IN (
       SELECT id FROM public.stagioni_backup
        WHERE stabilimento_id = p_stabilimento_id
        ORDER BY created_at ASC
        LIMIT (v_count - 10)
     );
  END IF;

  PERFORM public.audit_log_write(
    p_stabilimento_id,
    'backup_stagione',
    'create_backup',
    COALESCE('Backup creato: ' || p_etichetta, 'Backup creato'),
    v_id,
    NULL
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crea_backup_stagione(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crea_backup_stagione(uuid, text) TO authenticated;

-- ============================================================
-- RPC: reset_stagione
-- ============================================================
-- p_mantieni_cb=true  → preserva clienti_stagionali + ombrelloni,
--                       azzera credito_saldo, cancella disponibilità + transazioni.
-- p_mantieni_cb=false → reset totale (cancella anche clienti + ombrelloni).
-- ============================================================

CREATE OR REPLACE FUNCTION public.reset_stagione(
  p_stabilimento_id uuid,
  p_mantieni_cb     boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid       uuid := (SELECT auth.uid());
  v_backup_id uuid;
  v_etichetta text;
BEGIN
  IF p_stabilimento_id IS NULL THEN
    RAISE EXCEPTION 'stabilimento_id obbligatorio';
  END IF;
  IF v_uid IS NOT NULL
     AND NOT public.is_admin(v_uid)
     AND NOT EXISTS (SELECT 1 FROM public.stabilimenti
                     WHERE id = p_stabilimento_id AND proprietario_id = v_uid) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  v_etichetta := CASE WHEN p_mantieni_cb
                      THEN 'Reset stagione (CB mantenuta)'
                      ELSE 'Reset stagione (totale)' END;

  -- 1. Backup automatico dello stato corrente
  v_backup_id := public.crea_backup_stagione(p_stabilimento_id, v_etichetta);

  -- 2. Sopprimo audit per-riga durante DELETE/UPDATE massivi
  PERFORM set_config('audit.batch_tag', 'reset_stagione', true);

  -- 3. Cancellazioni in ordine FK-safe
  DELETE FROM public.transazioni
   WHERE stabilimento_id = p_stabilimento_id;

  DELETE FROM public.disponibilita
   WHERE ombrellone_id IN (
     SELECT id FROM public.ombrelloni WHERE stabilimento_id = p_stabilimento_id
   );

  IF p_mantieni_cb THEN
    UPDATE public.clienti_stagionali
       SET credito_saldo = 0
     WHERE stabilimento_id = p_stabilimento_id
       AND credito_saldo IS DISTINCT FROM 0;
  ELSE
    DELETE FROM public.clienti_stagionali
     WHERE stabilimento_id = p_stabilimento_id;
    DELETE FROM public.ombrelloni
     WHERE stabilimento_id = p_stabilimento_id;
  END IF;

  PERFORM set_config('audit.batch_tag', '', true);

  -- 4. Audit log finale
  PERFORM public.audit_log_write(
    p_stabilimento_id,
    'backup_stagione',
    'reset',
    v_etichetta,
    v_backup_id,
    jsonb_build_object('mantieni_cb', p_mantieni_cb)
  );

  RETURN v_backup_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_stagione(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_stagione(uuid, boolean) TO authenticated;

-- ============================================================
-- RPC: ripristina_backup
-- ============================================================
-- Crea un backup pre-restore (così lo stato attuale è recuperabile),
-- cancella lo stato corrente dello stabilimento e re-inserisce dal
-- payload del backup richiesto.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ripristina_backup(
  p_backup_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid           uuid := (SELECT auth.uid());
  v_stab_id       uuid;
  v_payload       jsonb;
  v_pre_backup_id uuid;
  v_created_at    timestamptz;
BEGIN
  SELECT stabilimento_id, payload, created_at
    INTO v_stab_id, v_payload, v_created_at
    FROM public.stagioni_backup
   WHERE id = p_backup_id;

  IF v_stab_id IS NULL THEN
    RAISE EXCEPTION 'Backup non trovato';
  END IF;

  IF v_uid IS NOT NULL
     AND NOT public.is_admin(v_uid)
     AND NOT EXISTS (SELECT 1 FROM public.stabilimenti
                     WHERE id = v_stab_id AND proprietario_id = v_uid) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  -- 1. Backup automatico pre-ripristino
  v_pre_backup_id := public.crea_backup_stagione(
    v_stab_id,
    'Stato pre-ripristino del backup ' || to_char(v_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')
  );

  -- 2. Sopprimo audit per-riga durante batch DELETE/INSERT
  PERFORM set_config('audit.batch_tag', 'ripristina_backup', true);

  -- 3. DELETE stato corrente in ordine FK-safe
  DELETE FROM public.transazioni
   WHERE stabilimento_id = v_stab_id;
  DELETE FROM public.disponibilita
   WHERE ombrellone_id IN (
     SELECT id FROM public.ombrelloni WHERE stabilimento_id = v_stab_id
   );
  DELETE FROM public.clienti_stagionali
   WHERE stabilimento_id = v_stab_id;
  DELETE FROM public.ombrelloni
   WHERE stabilimento_id = v_stab_id;

  -- 4. RE-INSERT da payload (jsonb_populate_recordset preserva tutte le colonne)
  INSERT INTO public.ombrelloni
  SELECT * FROM jsonb_populate_recordset(
    NULL::public.ombrelloni,
    COALESCE(v_payload->'ombrelloni', '[]'::jsonb)
  );

  INSERT INTO public.clienti_stagionali
  SELECT * FROM jsonb_populate_recordset(
    NULL::public.clienti_stagionali,
    COALESCE(v_payload->'clienti_stagionali', '[]'::jsonb)
  );

  INSERT INTO public.disponibilita
  SELECT * FROM jsonb_populate_recordset(
    NULL::public.disponibilita,
    COALESCE(v_payload->'disponibilita', '[]'::jsonb)
  );

  INSERT INTO public.transazioni
  SELECT * FROM jsonb_populate_recordset(
    NULL::public.transazioni,
    COALESCE(v_payload->'transazioni', '[]'::jsonb)
  );

  PERFORM set_config('audit.batch_tag', '', true);

  -- 5. Audit log finale
  PERFORM public.audit_log_write(
    v_stab_id,
    'backup_stagione',
    'restore',
    'Ripristino backup del ' || to_char(v_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
    p_backup_id,
    jsonb_build_object('pre_restore_backup_id', v_pre_backup_id)
  );

  RETURN v_pre_backup_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.ripristina_backup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ripristina_backup(uuid) TO authenticated;
