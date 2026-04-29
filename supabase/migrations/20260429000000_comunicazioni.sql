-- ============================================================
-- Comunicazioni: bozze email + tipo transazione "comunicazione_ricevuta"
-- + nuova action audit "email_batch_sent" aggregata
-- ============================================================
-- Aggiunge:
--   * Tabella `email_bozze` per salvare/caricare/sovrascrivere bozze
--     riutilizzabili dal proprietario nel tab "Comunicazioni".
--   * Estensione del CHECK su `transazioni.tipo` per includere
--     `comunicazione_ricevuta` (importo=0, una riga per cliente
--     destinatario di una email broadcast — visibile nelle transazioni
--     del cliente stagionale).
--   * Estensione del CHECK su `audit_log.action` per includere
--     `email_batch_sent` + allowlist in `audit_log_write` per scrivere
--     l'evento aggregato lato proprietario.
-- ============================================================

-- ============================================================
-- 1) Tabella email_bozze
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_bozze (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stabilimento_id uuid NOT NULL REFERENCES public.stabilimenti(id) ON DELETE CASCADE,
  etichetta       text NOT NULL,
  oggetto         text NOT NULL DEFAULT '',
  corpo           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_bozze_etichetta_len CHECK (char_length(etichetta) BETWEEN 1 AND 80),
  CONSTRAINT email_bozze_oggetto_len   CHECK (char_length(oggetto) <= 200),
  CONSTRAINT email_bozze_corpo_len     CHECK (char_length(corpo)   <= 8000)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_bozze_stab_etichetta_unique
  ON public.email_bozze (stabilimento_id, etichetta);

CREATE INDEX IF NOT EXISTS idx_email_bozze_stab_updated
  ON public.email_bozze (stabilimento_id, updated_at DESC);

-- updated_at touch trigger
CREATE OR REPLACE FUNCTION public._email_bozze_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS email_bozze_touch_updated_at ON public.email_bozze;
CREATE TRIGGER email_bozze_touch_updated_at
  BEFORE UPDATE ON public.email_bozze
  FOR EACH ROW
  EXECUTE FUNCTION public._email_bozze_touch_updated_at();

ALTER TABLE public.email_bozze ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_bozze_select_owner ON public.email_bozze;
DROP POLICY IF EXISTS email_bozze_insert_owner ON public.email_bozze;
DROP POLICY IF EXISTS email_bozze_update_owner ON public.email_bozze;
DROP POLICY IF EXISTS email_bozze_delete_owner ON public.email_bozze;
DROP POLICY IF EXISTS email_bozze_admin_all    ON public.email_bozze;

CREATE POLICY email_bozze_select_owner ON public.email_bozze
  FOR SELECT USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );

CREATE POLICY email_bozze_insert_owner ON public.email_bozze
  FOR INSERT WITH CHECK (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );

CREATE POLICY email_bozze_update_owner ON public.email_bozze
  FOR UPDATE USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  ) WITH CHECK (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );

CREATE POLICY email_bozze_delete_owner ON public.email_bozze
  FOR DELETE USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );

CREATE POLICY email_bozze_admin_all ON public.email_bozze
  FOR ALL USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

-- ============================================================
-- 2) Estensione transazioni.tipo per "comunicazione_ricevuta"
-- ============================================================
-- Conserva tutti i valori introdotti dalle migrazioni precedenti.

ALTER TABLE public.transazioni
  DROP CONSTRAINT IF EXISTS transazioni_tipo_check;

ALTER TABLE public.transazioni
  ADD CONSTRAINT transazioni_tipo_check CHECK (
    tipo = ANY (ARRAY[
      'disponibilita_aggiunta'::text,
      'disponibilita_rimossa'::text,
      'sub_affitto'::text,
      'sub_affitto_annullato'::text,
      'credito_ricevuto'::text,
      'credito_usato'::text,
      'credito_revocato'::text,
      'regola_forzata_aggiunta'::text,
      'regola_forzata_rimossa'::text,
      'comunicazione_ricevuta'::text
    ])
  );

-- ============================================================
-- 3) audit_log: nuova action "email_batch_sent" + allowlist RPC
-- ============================================================

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check
  CHECK (action = ANY (ARRAY[
    'insert','update','delete','login','email_sent','import_batch',
    'create_backup','reset','restore','email_batch_sent'
  ]));

-- Riscrivo audit_log_write per estendere l'allowlist senza cambiare semantica.
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
  IF p_action NOT IN ('login','email_sent','import_batch','create_backup','reset','restore','email_batch_sent') THEN
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

GRANT EXECUTE ON FUNCTION public.audit_log_write(uuid, text, text, text, uuid, jsonb) TO authenticated;
