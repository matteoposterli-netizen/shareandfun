-- ============================================================
-- 20260426000000 — Sblocca i reinviti su email "stuck" in auth.users
--
-- Due modifiche complementari:
--
-- 1) public.unblock_invito_email(p_token uuid) → boolean
--    Self-healing dal lato cliente: quando il cliente clicca il link
--    di invito e auth.signUp fallisce con "User already registered",
--    il frontend chiama questa RPC che cancella l'eventuale
--    auth.users orfano associato all'email del cliente.
--    SECURITY DEFINER, idempotente. Filtri di sicurezza identici
--    a reset_stagione: nessun altro clienti_stagionali, no
--    proprietario, no admin. Cascata su public.profiles via FK.
--
-- 2) public.reset_stagione v4
--    Estende la pulizia di auth.users: oltre agli user_id già
--    collegati a clienti_stagionali al momento del reset, ora copre
--    anche gli auth.users associati per EMAIL ai clienti dello
--    stabilimento. Questo gestisce il caso "invitato ma mai
--    finalizzato": signUp avviato → auth.users creato → ma
--    completa_registrazione_invito mai chiamato → cliente.user_id
--    è rimasto NULL e il vecchio reset non lo catturava.
--    Filtri di orfanità invariati.
-- ============================================================

CREATE OR REPLACE FUNCTION public.unblock_invito_email(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_email   text;
  v_user_id uuid;
  v_deleted boolean := false;
BEGIN
  IF p_token IS NULL THEN
    RETURN false;
  END IF;

  SELECT email
    INTO v_email
    FROM public.clienti_stagionali
   WHERE invito_token = p_token
     AND user_id IS NULL
   LIMIT 1;

  IF v_email IS NULL OR length(trim(v_email)) = 0 THEN
    RETURN false;
  END IF;

  SELECT id
    INTO v_user_id
    FROM auth.users
   WHERE lower(email) = lower(v_email)
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  WITH deleted AS (
    DELETE FROM auth.users au
     WHERE au.id = v_user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.clienti_stagionali cs
          WHERE cs.user_id = au.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles p
          WHERE p.id = au.id
            AND p.ruolo = 'proprietario'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.admins a
          WHERE a.user_id = au.id
       )
     RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM deleted) INTO v_deleted;

  RETURN v_deleted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.unblock_invito_email(uuid) TO anon, authenticated;


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
  v_uid              uuid := (SELECT auth.uid());
  v_backup_id        uuid;
  v_etichetta        text;
  v_user_ids         uuid[];
  v_emails           text[];
  v_email_user_ids   uuid[];
  v_target_ids       uuid[];
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

  v_backup_id := public.crea_backup_stagione(p_stabilimento_id, v_etichetta);

  SELECT array_agg(user_id)
    INTO v_user_ids
    FROM public.clienti_stagionali
   WHERE stabilimento_id = p_stabilimento_id
     AND user_id IS NOT NULL;

  SELECT array_agg(DISTINCT lower(email))
    INTO v_emails
    FROM public.clienti_stagionali
   WHERE stabilimento_id = p_stabilimento_id
     AND email IS NOT NULL
     AND length(trim(email)) > 0;

  IF v_emails IS NOT NULL AND array_length(v_emails, 1) > 0 THEN
    SELECT array_agg(id)
      INTO v_email_user_ids
      FROM auth.users
     WHERE lower(email) = ANY (v_emails);
  END IF;

  SELECT array_agg(DISTINCT x)
    INTO v_target_ids
    FROM unnest(
      COALESCE(v_user_ids,       ARRAY[]::uuid[]) ||
      COALESCE(v_email_user_ids, ARRAY[]::uuid[])
    ) AS x
   WHERE x IS NOT NULL;

  PERFORM set_config('audit.batch_tag', 'reset_stagione', true);

  DELETE FROM public.transazioni
   WHERE stabilimento_id = p_stabilimento_id;

  DELETE FROM public.disponibilita
   WHERE ombrellone_id IN (
     SELECT id FROM public.ombrelloni WHERE stabilimento_id = p_stabilimento_id
   );

  IF p_mantieni_cb THEN
    UPDATE public.clienti_stagionali
       SET credito_saldo = 0,
           user_id       = NULL,
           invitato_at   = NULL,
           approvato     = false,
           rifiutato     = false,
           invito_token  = gen_random_uuid()
     WHERE stabilimento_id = p_stabilimento_id;
  ELSE
    DELETE FROM public.clienti_stagionali
     WHERE stabilimento_id = p_stabilimento_id;
    DELETE FROM public.ombrelloni
     WHERE stabilimento_id = p_stabilimento_id;
  END IF;

  IF v_target_ids IS NOT NULL AND array_length(v_target_ids, 1) > 0 THEN
    DELETE FROM auth.users au
     WHERE au.id = ANY (v_target_ids)
       AND NOT EXISTS (
         SELECT 1 FROM public.clienti_stagionali cs
          WHERE cs.user_id = au.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles p
          WHERE p.id = au.id
            AND p.ruolo = 'proprietario'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.admins a
          WHERE a.user_id = au.id
       );
  END IF;

  PERFORM set_config('audit.batch_tag', '', true);

  PERFORM public.audit_log_write(
    p_stabilimento_id,
    'backup_stagione',
    'reset',
    v_etichetta,
    v_backup_id,
    jsonb_build_object(
      'mantieni_cb',         p_mantieni_cb,
      'auth_users_cleaned',  COALESCE(array_length(v_target_ids, 1), 0)
    )
  );

  RETURN v_backup_id;
END;
$function$;
