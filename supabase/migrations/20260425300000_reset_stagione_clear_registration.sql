-- ============================================================
-- reset_stagione v2: con mantieni_cb=true, oltre ad azzerare il saldo coin,
-- resetta lo stato di registrazione dei clienti stagionali (user_id NULL,
-- invitato_at NULL, approvato/rifiutato false, nuovo invito_token).
--
-- Motivazione: dopo un reset stagione l'esercente vuole rimandare gli inviti
-- per la nuova stagione. Lasciando `user_id` valorizzato il cliente continuava
-- a vedersi come "Cliente attivo" in tabella, anche se la stagione era nuova.
--
-- Il record `auth.users` corrispondente NON viene cancellato qui (potrebbe
-- essere usato da altri stabilimenti). Il proprietario può eventualmente
-- pulirlo manualmente dal dashboard Supabase.
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

  PERFORM set_config('audit.batch_tag', 'reset_stagione', true);

  DELETE FROM public.transazioni
   WHERE stabilimento_id = p_stabilimento_id;

  DELETE FROM public.disponibilita
   WHERE ombrellone_id IN (
     SELECT id FROM public.ombrelloni WHERE stabilimento_id = p_stabilimento_id
   );

  IF p_mantieni_cb THEN
    -- Azzera saldo + resetta stato di registrazione (user_id orfano,
    -- token rigenerato, approvazione e rifiuto azzerati). Anagrafica
    -- (nome/cognome/email/telefono/ombrellone_id) e fonte preservate.
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

  PERFORM set_config('audit.batch_tag', '', true);

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
