-- ============================================================
-- cancella_account_proprietario()
-- Cancella tutto l'account del proprietario chiamante:
-- - tutti i dati dello stabilimento (cascade)
-- - auth.users (cascade su profiles)
-- Sicurezza: solo il proprietario può cancellare il proprio account.
-- Non applicabile agli admin.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancella_account_proprietario()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_stab_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non autenticato' USING ERRCODE = '42501';
  END IF;

  -- Solo proprietari, non admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND ruolo = 'proprietario'
  ) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_stab_id
  FROM public.stabilimenti
  WHERE proprietario_id = v_uid
  LIMIT 1;

  -- Cancella tutto il business data nello stabilimento
  IF v_stab_id IS NOT NULL THEN
    DELETE FROM public.audit_log         WHERE stabilimento_id = v_stab_id;
    DELETE FROM public.email_bozze       WHERE stabilimento_id = v_stab_id;
    DELETE FROM public.stagioni_backup   WHERE stabilimento_id = v_stab_id;
    DELETE FROM public.regole_stato_ombrelloni WHERE stabilimento_id = v_stab_id;
    DELETE FROM public.transazioni       WHERE stabilimento_id = v_stab_id;
    DELETE FROM public.disponibilita
      WHERE ombrellone_id IN (
        SELECT id FROM public.ombrelloni WHERE stabilimento_id = v_stab_id
      );
    DELETE FROM public.clienti_stagionali WHERE stabilimento_id = v_stab_id;
    DELETE FROM public.ombrelloni        WHERE stabilimento_id = v_stab_id;
    DELETE FROM public.stabilimenti      WHERE id = v_stab_id;
  END IF;

  -- Cancella auth.users → cascade su profiles (FK ON DELETE CASCADE)
  DELETE FROM auth.users WHERE id = v_uid;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancella_account_proprietario() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancella_account_proprietario() TO authenticated;
