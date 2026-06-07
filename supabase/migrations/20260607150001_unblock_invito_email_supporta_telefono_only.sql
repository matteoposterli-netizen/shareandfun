-- Fix: quando il cliente_stagionale invitato ha email NULL (telefono-only),
-- la funzione unblock_invito_email ricava l'email sintetica dal telefono
-- (<digits>@phone.spiaggiamia.it) e prova a ripulire l'eventuale auth.user
-- orfana con le stesse guardie (no cs collegati, no proprietario, no admin).
--
-- Applicato in produzione: 2026-06-07.

CREATE OR REPLACE FUNCTION public.unblock_invito_email(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email    text;
  v_telefono text;
  v_user_id  uuid;
  v_deleted  boolean := false;
BEGIN
  IF p_token IS NULL THEN
    RETURN false;
  END IF;

  SELECT email, telefono
    INTO v_email, v_telefono
    FROM public.clienti_stagionali
   WHERE invito_token = p_token
     AND user_id IS NULL
   LIMIT 1;

  -- Se email assente, ricava email sintetica dal telefono
  IF v_email IS NULL OR length(trim(v_email)) = 0 THEN
    IF v_telefono IS NULL OR length(trim(v_telefono)) = 0 THEN
      RETURN false;
    END IF;
    v_email := regexp_replace(v_telefono, '\D', '', 'g') || '@phone.spiaggiamia.it';
    IF v_email = '@phone.spiaggiamia.it' THEN
      RETURN false;
    END IF;
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
