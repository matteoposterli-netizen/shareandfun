-- ============================================================
-- reset_stagione v3: oltre ad azzerare lo stato di registrazione dei
-- clienti stagionali, cancella anche le righe orfane di `auth.users`
-- (e a cascata `public.profiles`) che restavano in vita dopo il reset.
--
-- Motivazione:
--   Dopo il reset con `mantieni_cb=true`, `clienti_stagionali.user_id`
--   viene azzerato per consentire un nuovo invito. Tuttavia il record
--   `auth.users` corrispondente restava in vita: quando il cliente
--   cliccava il nuovo link di invito, `sb.auth.signUp({ email })`
--   falliva con "User already registered" (l'email risulta ancora
--   associata a un account in Supabase Auth).
--
--   La fix elimina dall'auth schema solo gli utenti che non hanno
--   più alcun legame business: niente altri `clienti_stagionali`
--   (multi-stabilimento), niente `profiles` con ruolo `proprietario`,
--   niente riga in `admins`. Lo stesso vale per il reset totale:
--   se i clienti vengono cancellati senza pulire `auth.users`, anche
--   il riadd manuale del cliente con la stessa email fallirebbe al
--   prossimo invito.
--
--   La cascata fa il resto: `profiles.id` ha FK ON DELETE CASCADE
--   verso `auth.users(id)`, quindi il delete su `auth.users` rimuove
--   automaticamente la riga `profiles` dello stagionale.
--
-- Idempotente: CREATE OR REPLACE.
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
  v_user_ids  uuid[];
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

  -- Cattura gli user_id collegati ai clienti dello stabilimento PRIMA
  -- di azzerarli/cancellarli, così possiamo poi ripulire le righe
  -- orfane di auth.users.
  SELECT array_agg(user_id) INTO v_user_ids
    FROM public.clienti_stagionali
   WHERE stabilimento_id = p_stabilimento_id
     AND user_id IS NOT NULL;

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

  -- Cancella le righe `auth.users` ormai orfane (cascata su profiles).
  -- Filtri di sicurezza: l'utente non deve essere proprietario di altri
  -- stabilimenti, non deve essere admin, e non deve essere ancora
  -- collegato come stagionale a qualche altro stabilimento.
  IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
    DELETE FROM auth.users au
     WHERE au.id = ANY (v_user_ids)
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
      'auth_users_cleaned',  COALESCE(array_length(v_user_ids, 1), 0)
    )
  );

  RETURN v_backup_id;
END;
$function$;
