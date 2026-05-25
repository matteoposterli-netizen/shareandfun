-- RPC SECURITY DEFINER per cancellare tutti i dati del proprietario
-- Chiamata dal frontend con supabase.rpc('cancella_account_proprietario')
-- Verifica che auth.uid() sia il proprietario del stabilimento
-- prima di cancellare qualsiasi cosa.

CREATE OR REPLACE FUNCTION public.cancella_account_proprietario()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_stab_id     uuid;
BEGIN
  -- 1. Recupera il stabilimento_id del proprietario corrente
  SELECT id INTO v_stab_id
  FROM public.stabilimenti
  WHERE proprietario_id = v_user_id;

  IF v_stab_id IS NULL THEN
    RAISE EXCEPTION 'Nessun stabilimento trovato per questo utente.';
  END IF;

  -- 2. Cancella in ordine per rispettare i vincoli FK
  --    (audit_log ha FK su stabilimento_id con trigger che scatta
  --     durante le delete, quindi lo cancelliamo prima)

  DELETE FROM public.audit_log
  WHERE stabilimento_id = v_stab_id;

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

  DELETE FROM public.email_bozze
  WHERE stabilimento_id = v_stab_id;

  DELETE FROM public.regole_stato_ombrelloni
  WHERE stabilimento_id = v_stab_id;

  DELETE FROM public.stabilimenti
  WHERE id = v_stab_id;

  -- 3. Cancella il profilo
  DELETE FROM public.profiles
  WHERE id = v_user_id;

  -- 4. Cancella l'utente da auth.users
  --    (SECURITY DEFINER con search_path che include 'auth' consente questa operazione)
  DELETE FROM auth.users
  WHERE id = v_user_id;

END;
$$;

-- Revoca accesso pubblico, solo authenticated
REVOKE ALL ON FUNCTION public.cancella_account_proprietario() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancella_account_proprietario() TO authenticated;
