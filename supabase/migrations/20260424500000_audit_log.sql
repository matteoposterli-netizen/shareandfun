-- Audit log per il proprietario: registra tutte le modifiche alle entità del
-- suo stabilimento + login del proprietario + email transazionali.
--
-- Design notes:
-- * Nessun backfill storico: il log inizia dal momento in cui la migrazione
--   viene applicata.
-- * Una riga per ogni INSERT/UPDATE/DELETE su transazioni, disponibilita,
--   clienti_stagionali, ombrelloni, stabilimenti, profiles (solo profili
--   legati a uno stabilimento).
-- * Login del proprietario e email inviate sono loggati via RPC audit_log_write
--   (chiamate da js/auth.js e supabase/functions/invia-email).
-- * Import Excel: il client chiama audit_coalesce_import() al termine per
--   sostituire le N righe per-riga con un'unica riga aggregata.
-- * La GUC di sessione `audit.batch_tag` sopprime il log per-riga nei casi
--   futuri in cui l'import venga racchiuso in un'unica RPC transazionale.
-- * Retention 30 giorni via pg_cron.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stabilimento_id uuid NOT NULL REFERENCES public.stabilimenti(id) ON DELETE CASCADE,
  actor_type      text NOT NULL CHECK (actor_type = ANY (ARRAY['proprietario','stagionale','admin','sistema'])),
  actor_id        uuid,
  actor_label     text,
  entity_type     text NOT NULL CHECK (entity_type = ANY (ARRAY['transazione','disponibilita','cliente_stagionale','ombrellone','stabilimento','profile','email','auth','import'])),
  entity_id       uuid,
  action          text NOT NULL CHECK (action = ANY (ARRAY['insert','update','delete','login','email_sent','import_batch'])),
  before          jsonb,
  after           jsonb,
  diff            jsonb,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_stab_created     ON public.audit_log (stabilimento_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id         ON public.audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type_time ON public.audit_log (entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action           ON public.audit_log (action);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_select_owner ON public.audit_log;
DROP POLICY IF EXISTS audit_log_select_admin ON public.audit_log;

CREATE POLICY audit_log_select_owner ON public.audit_log
  FOR SELECT USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );
CREATE POLICY audit_log_select_admin ON public.audit_log
  FOR SELECT USING (public.is_admin((SELECT auth.uid())));

-- Nessuna policy INSERT/UPDATE/DELETE: la scrittura avviene esclusivamente
-- via trigger SECURITY DEFINER o RPC audit_log_write / audit_coalesce_import.

-- ============================================================
-- Helper: attore corrente (proprietario / stagionale / admin / sistema)
-- ============================================================

CREATE OR REPLACE FUNCTION public._audit_current_actor()
RETURNS TABLE(actor_type text, actor_id uuid, actor_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_prof  record;
  v_stag  record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT 'sistema'::text, NULL::uuid, 'Sistema'::text;
    RETURN;
  END IF;

  IF public.is_admin(v_uid) THEN
    RETURN QUERY SELECT 'admin'::text, v_uid,
      COALESCE((SELECT email FROM auth.users WHERE id = v_uid), 'Admin')::text;
    RETURN;
  END IF;

  SELECT p.nome, p.cognome, p.ruolo INTO v_prof
  FROM public.profiles p WHERE p.id = v_uid;

  IF v_prof IS NULL THEN
    RETURN QUERY SELECT 'sistema'::text, v_uid, 'Utente sconosciuto'::text;
    RETURN;
  END IF;

  IF v_prof.ruolo = 'proprietario' THEN
    RETURN QUERY SELECT 'proprietario'::text, v_uid,
      (coalesce(v_prof.nome,'') || ' ' || coalesce(v_prof.cognome,''))::text;
    RETURN;
  END IF;

  SELECT cs.nome, cs.cognome, cs.email INTO v_stag
  FROM public.clienti_stagionali cs WHERE cs.user_id = v_uid LIMIT 1;

  RETURN QUERY SELECT
    'stagionale'::text,
    v_uid,
    (coalesce(v_stag.nome, v_prof.nome, '') || ' ' ||
     coalesce(v_stag.cognome, v_prof.cognome, '') ||
     CASE WHEN v_stag.email IS NOT NULL THEN ' <' || v_stag.email || '>' ELSE '' END)::text;
END;
$function$;

REVOKE ALL ON FUNCTION public._audit_current_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._audit_current_actor() TO authenticated;

-- ============================================================
-- Helper: risoluzione stabilimento_id
-- ============================================================

CREATE OR REPLACE FUNCTION public._audit_stab_from_ombrellone(p_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT stabilimento_id FROM public.ombrelloni WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public._audit_stab_from_profile(p_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT stabilimento_id FROM public.clienti_stagionali WHERE user_id = p_id LIMIT 1;
$$;

-- ============================================================
-- Helper: diff JSON
-- ============================================================

CREATE OR REPLACE FUNCTION public._audit_json_diff(p_before jsonb, p_after jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
  v_key  text;
  v_bval jsonb;
  v_aval jsonb;
  v_out  jsonb := '{}'::jsonb;
BEGIN
  IF p_before IS NULL OR p_after IS NULL THEN
    RETURN NULL;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_before) UNION SELECT jsonb_object_keys(p_after)
  LOOP
    v_bval := p_before -> v_key;
    v_aval := p_after  -> v_key;
    IF v_bval IS DISTINCT FROM v_aval THEN
      v_out := v_out || jsonb_build_object(v_key, jsonb_build_object('before', v_bval, 'after', v_aval));
    END IF;
  END LOOP;
  IF v_out = '{}'::jsonb THEN RETURN NULL; END IF;
  RETURN v_out;
END;
$function$;

-- ============================================================
-- Description builder (italiano, human-readable)
-- ============================================================

CREATE OR REPLACE FUNCTION public._audit_describe(
  p_entity text, p_action text, p_before jsonb, p_after jsonb, p_diff jsonb
) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
  v_desc text;
  v_row  jsonb := COALESCE(p_after, p_before);
  v_keys text;
BEGIN
  IF p_entity = 'transazione' THEN
    IF p_action = 'insert' THEN
      v_desc := 'Transazione ' || COALESCE(v_row ->> 'tipo','?') ||
                ' · importo ' || COALESCE(v_row ->> 'importo','0') ||
                CASE WHEN v_row ->> 'nota' IS NOT NULL AND v_row ->> 'nota' <> ''
                     THEN ' · ' || (v_row ->> 'nota') ELSE '' END;
    ELSIF p_action = 'delete' THEN
      v_desc := 'Transazione eliminata (' || COALESCE(v_row ->> 'tipo','?') || ')';
    ELSE
      v_desc := 'Transazione modificata';
    END IF;

  ELSIF p_entity = 'disponibilita' THEN
    IF p_action = 'insert' THEN
      v_desc := 'Disponibilità ' || COALESCE(v_row ->> 'stato','libero') ||
                ' per il ' || COALESCE(v_row ->> 'data','?');
    ELSIF p_action = 'delete' THEN
      v_desc := 'Disponibilità rimossa per il ' || COALESCE(v_row ->> 'data','?');
    ELSE
      v_desc := 'Disponibilità aggiornata per il ' || COALESCE(v_row ->> 'data','?') ||
                CASE WHEN p_diff ? 'stato'
                     THEN ' (stato: ' || (p_diff #>> '{stato,before}') || ' → ' || (p_diff #>> '{stato,after}') || ')'
                     ELSE '' END;
    END IF;

  ELSIF p_entity = 'cliente_stagionale' THEN
    IF p_action = 'insert' THEN
      v_desc := 'Cliente stagionale aggiunto: ' || COALESCE(v_row ->> 'nome','') || ' ' ||
                COALESCE(v_row ->> 'cognome','') || ' <' || COALESCE(v_row ->> 'email','') || '>';
    ELSIF p_action = 'delete' THEN
      v_desc := 'Cliente stagionale eliminato: ' || COALESCE(v_row ->> 'email','?');
    ELSE
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Cliente ' || COALESCE(v_row ->> 'email','?') || ' modificato (' || COALESCE(v_keys,'–') || ')';
    END IF;

  ELSIF p_entity = 'ombrellone' THEN
    IF p_action = 'insert' THEN
      v_desc := 'Ombrellone aggiunto: Fila ' || COALESCE(v_row ->> 'fila','?') ||
                ' N°' || COALESCE(v_row ->> 'numero','?') ||
                ' · credito/gg ' || COALESCE(v_row ->> 'credito_giornaliero','?');
    ELSIF p_action = 'delete' THEN
      v_desc := 'Ombrellone eliminato: Fila ' || COALESCE(v_row ->> 'fila','?') ||
                ' N°' || COALESCE(v_row ->> 'numero','?');
    ELSE
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Ombrellone Fila ' || COALESCE(v_row ->> 'fila','?') ||
                ' N°' || COALESCE(v_row ->> 'numero','?') || ' modificato (' || COALESCE(v_keys,'–') || ')';
    END IF;

  ELSIF p_entity = 'stabilimento' THEN
    IF p_action = 'update' THEN
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Stabilimento aggiornato (' || COALESCE(v_keys,'–') || ')';
    ELSIF p_action = 'insert' THEN
      v_desc := 'Stabilimento creato';
    ELSE
      v_desc := 'Stabilimento eliminato';
    END IF;

  ELSIF p_entity = 'profile' THEN
    IF p_action = 'update' THEN
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Profilo utente aggiornato (' || COALESCE(v_keys,'–') || ')';
    ELSIF p_action = 'insert' THEN
      v_desc := 'Profilo utente creato';
    ELSE
      v_desc := 'Profilo utente eliminato';
    END IF;
  END IF;

  RETURN v_desc;
END;
$function$;

-- ============================================================
-- Trigger generico parametrizzato
-- ============================================================

CREATE OR REPLACE FUNCTION public._audit_row_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entity_type text;
  v_action      text;
  v_stab_id     uuid;
  v_entity_id   uuid;
  v_before      jsonb;
  v_after       jsonb;
  v_diff        jsonb;
  v_actor       record;
  v_desc        text;
  v_batch_tag   text;
BEGIN
  -- Soppressione per batch (future RPC transazionali).
  BEGIN
    v_batch_tag := current_setting('audit.batch_tag', true);
  EXCEPTION WHEN OTHERS THEN
    v_batch_tag := NULL;
  END;
  IF v_batch_tag IS NOT NULL AND v_batch_tag <> '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_entity_type := TG_ARGV[0];
  v_action      := lower(TG_OP);

  IF v_action = 'delete' THEN
    v_before    := to_jsonb(OLD);
    v_after     := NULL;
    v_entity_id := (OLD).id;
  ELSIF v_action = 'insert' THEN
    v_before    := NULL;
    v_after     := to_jsonb(NEW);
    v_entity_id := (NEW).id;
  ELSE
    v_before    := to_jsonb(OLD);
    v_after     := to_jsonb(NEW);
    v_entity_id := (NEW).id;
    v_diff      := public._audit_json_diff(v_before, v_after);
    IF v_diff IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_entity_type IN ('transazione','cliente_stagionale','ombrellone') THEN
    v_stab_id := COALESCE((v_after ->> 'stabilimento_id')::uuid, (v_before ->> 'stabilimento_id')::uuid);
  ELSIF v_entity_type = 'stabilimento' THEN
    v_stab_id := COALESCE((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid);
  ELSIF v_entity_type = 'disponibilita' THEN
    v_stab_id := public._audit_stab_from_ombrellone(
      COALESCE((v_after ->> 'ombrellone_id')::uuid, (v_before ->> 'ombrellone_id')::uuid)
    );
  ELSIF v_entity_type = 'profile' THEN
    v_stab_id := public._audit_stab_from_profile(
      COALESCE((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid)
    );
  END IF;

  IF v_stab_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Per stabilimento DELETE saltiamo: la cascade eliminerebbe subito la riga di log.
  IF v_entity_type = 'stabilimento' AND v_action = 'delete' THEN
    RETURN OLD;
  END IF;

  SELECT * INTO v_actor FROM public._audit_current_actor();
  v_desc := public._audit_describe(v_entity_type, v_action, v_before, v_after, v_diff);

  INSERT INTO public.audit_log (
    stabilimento_id, actor_type, actor_id, actor_label,
    entity_type, entity_id, action, before, after, diff, description
  ) VALUES (
    v_stab_id, v_actor.actor_type, v_actor.actor_id, v_actor.actor_label,
    v_entity_type, v_entity_id, v_action, v_before, v_after, v_diff, v_desc
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ============================================================
-- Attacco trigger alle tabelle
-- ============================================================

DROP TRIGGER IF EXISTS audit_transazioni        ON public.transazioni;
DROP TRIGGER IF EXISTS audit_disponibilita      ON public.disponibilita;
DROP TRIGGER IF EXISTS audit_clienti_stagionali ON public.clienti_stagionali;
DROP TRIGGER IF EXISTS audit_ombrelloni         ON public.ombrelloni;
DROP TRIGGER IF EXISTS audit_stabilimenti       ON public.stabilimenti;
DROP TRIGGER IF EXISTS audit_profiles           ON public.profiles;

CREATE TRIGGER audit_transazioni
  AFTER INSERT OR UPDATE OR DELETE ON public.transazioni
  FOR EACH ROW EXECUTE FUNCTION public._audit_row_trigger('transazione');

CREATE TRIGGER audit_disponibilita
  AFTER INSERT OR UPDATE OR DELETE ON public.disponibilita
  FOR EACH ROW EXECUTE FUNCTION public._audit_row_trigger('disponibilita');

CREATE TRIGGER audit_clienti_stagionali
  AFTER INSERT OR UPDATE OR DELETE ON public.clienti_stagionali
  FOR EACH ROW EXECUTE FUNCTION public._audit_row_trigger('cliente_stagionale');

CREATE TRIGGER audit_ombrelloni
  AFTER INSERT OR UPDATE OR DELETE ON public.ombrelloni
  FOR EACH ROW EXECUTE FUNCTION public._audit_row_trigger('ombrellone');

CREATE TRIGGER audit_stabilimenti
  AFTER INSERT OR UPDATE OR DELETE ON public.stabilimenti
  FOR EACH ROW EXECUTE FUNCTION public._audit_row_trigger('stabilimento');

CREATE TRIGGER audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._audit_row_trigger('profile');

-- ============================================================
-- RPC audit_log_write: log manuale (login, email)
-- ============================================================

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
  IF p_entity_type NOT IN ('email','auth','import') THEN
    RAISE EXCEPTION 'entity_type non valido per audit_log_write: %', p_entity_type;
  END IF;
  IF p_action NOT IN ('login','email_sent','import_batch') THEN
    RAISE EXCEPTION 'action non valida per audit_log_write: %', p_action;
  END IF;

  -- Auth: proprietario dello stabilimento, admin, o service_role (v_uid NULL).
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

REVOKE ALL ON FUNCTION public.audit_log_write(uuid, text, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_log_write(uuid, text, text, text, uuid, jsonb) TO authenticated, service_role;

-- ============================================================
-- RPC audit_coalesce_import: aggrega le N righe per-riga di un import
-- in un'unica riga "import_batch".
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_coalesce_import(
  p_stabilimento_id uuid,
  p_since           timestamptz,
  p_summary         text,
  p_metadata        jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_actor record;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL
     OR (NOT public.is_admin(v_uid)
         AND NOT EXISTS (SELECT 1 FROM public.stabilimenti
                         WHERE id = p_stabilimento_id AND proprietario_id = v_uid)) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.audit_log
  WHERE stabilimento_id = p_stabilimento_id
    AND actor_id        = v_uid
    AND created_at     >= p_since
    AND entity_type IN ('ombrellone','cliente_stagionale','transazione','disponibilita');

  SELECT * INTO v_actor FROM public._audit_current_actor();

  INSERT INTO public.audit_log (
    stabilimento_id, actor_type, actor_id, actor_label,
    entity_type, action, after, description
  ) VALUES (
    p_stabilimento_id, v_actor.actor_type, v_actor.actor_id, v_actor.actor_label,
    'import', 'import_batch', p_metadata, p_summary
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_coalesce_import(uuid, timestamptz, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_coalesce_import(uuid, timestamptz, text, jsonb) TO authenticated;

-- ============================================================
-- Retention 30 giorni via pg_cron
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit-log-retention') THEN
    PERFORM cron.unschedule('audit-log-retention');
  END IF;
END$$;

SELECT cron.schedule(
  'audit-log-retention',
  '0 3 * * *',
  $$DELETE FROM public.audit_log WHERE created_at < now() - interval '30 days'$$
);
