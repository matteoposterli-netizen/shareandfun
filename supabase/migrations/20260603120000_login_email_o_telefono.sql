-- ============================================================
-- LOGIN CON EMAIL O TELEFONO - FASE 1 BACKEND
-- ============================================================
-- Abilita ai clienti stagionali di accedere indistintamente con
-- email o numero di telefono. L'email rimane l'identificatore
-- primario su auth.users (vera per chi ce l'ha, sintetica per chi
-- ha solo il telefono). Il telefono diventa un alias di login.
--
-- Cosa fa questa migration:
--  1) Funzione helper _normalize_phone_e164(text) per normalizzare
--     i numeri in formato E.164 (+39... default ITA).
--  2) Trigger BEFORE INSERT/UPDATE su clienti_stagionali che
--     normalizza automaticamente il telefono.
--  3) Normalizzazione one-shot dei numeri esistenti.
--  4) Verifica conflitti di telefono tra clienti registrati
--     (raise exception se trovati: la migration NON va avanti).
--  5) Unique index parziale su (telefono) per i clienti registrati.
--  6) RPC risolvi_login_da_telefono(text) -> text (SECURITY DEFINER)
--     usata dalla pagina login.
--  7) RPC rigenera_invito_token(uuid) -> uuid (SECURITY DEFINER)
--     usata dal manager per rigenerare il link di invito.
--
-- Compatibilita': i 103 clienti esistenti (tutti con email vera)
-- non vengono toccati. Il trigger normalizza solo il campo telefono.
-- ============================================================

-- ---------------------------------------------------------
-- 1) Helper di normalizzazione E.164 (Italia default)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._normalize_phone_e164(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
BEGIN
  IF raw IS NULL OR length(trim(raw)) = 0 THEN
    RETURN NULL;
  END IF;
  -- Rimuove spazi, trattini, parentesi e punti
  s := regexp_replace(raw, '[\s\-().]', '', 'g');
  -- 00... -> +...
  IF s LIKE '00%' THEN
    s := '+' || substring(s from 3);
  END IF;
  -- Gia' E.164
  IF s LIKE '+%' THEN
    RETURN s;
  END IF;
  -- Cellulare IT (inizia con 3)
  IF s LIKE '3%' THEN
    RETURN '+39' || s;
  END IF;
  -- Fisso IT (inizia con 0)
  IF s LIKE '0%' THEN
    RETURN '+39' || s;
  END IF;
  -- Fallback: aggiunge solo il +
  RETURN '+' || s;
END $$;

COMMENT ON FUNCTION public._normalize_phone_e164(text) IS
'Normalizza un numero in E.164 (+39 default per ITA). Coerente con normalizzaTelefonoIT() in js/utils.js.';

-- ---------------------------------------------------------
-- 2) Trigger auto-normalizzazione su clienti_stagionali
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clienti_stagionali_norm_phone_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.telefono IS NOT NULL THEN
    NEW.telefono := public._normalize_phone_e164(NEW.telefono);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clienti_normalize_phone ON public.clienti_stagionali;
CREATE TRIGGER trg_clienti_normalize_phone
  BEFORE INSERT OR UPDATE OF telefono ON public.clienti_stagionali
  FOR EACH ROW
  EXECUTE FUNCTION public._clienti_stagionali_norm_phone_trg();

-- ---------------------------------------------------------
-- 3) Normalizzazione one-shot dei numeri esistenti
-- ---------------------------------------------------------
UPDATE public.clienti_stagionali
SET telefono = public._normalize_phone_e164(telefono)
WHERE telefono IS NOT NULL
  AND telefono <> public._normalize_phone_e164(telefono);

-- ---------------------------------------------------------
-- 4) Verifica conflitti tra clienti REGISTRATI (user_id IS NOT NULL)
--    Se ci sono duplicati, la migration si FERMA: vanno risolti
--    manualmente prima.
-- ---------------------------------------------------------
DO $$
DECLARE
  dup_count int;
  dup_record record;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT telefono
    FROM public.clienti_stagionali
    WHERE user_id IS NOT NULL AND telefono IS NOT NULL
    GROUP BY telefono
    HAVING count(*) > 1
  ) t;

  IF dup_count > 0 THEN
    -- Log dettagliato dei duplicati prima di lanciare l'eccezione
    FOR dup_record IN
      SELECT telefono, count(*) as n, array_agg(id::text) as ids, array_agg(email) as emails
      FROM public.clienti_stagionali
      WHERE user_id IS NOT NULL AND telefono IS NOT NULL
      GROUP BY telefono
      HAVING count(*) > 1
    LOOP
      RAISE NOTICE 'CONFLITTO telefono % (% clienti): ids=% emails=%',
        dup_record.telefono, dup_record.n, dup_record.ids, dup_record.emails;
    END LOOP;
    RAISE EXCEPTION 'Trovati % telefoni duplicati tra clienti registrati. Risolvere manualmente prima di applicare la migration.', dup_count;
  END IF;
END $$;

-- ---------------------------------------------------------
-- 5) Unique index parziale: telefono unico tra clienti REGISTRATI
-- ---------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_telefono_clienti_registrati
  ON public.clienti_stagionali (telefono)
  WHERE user_id IS NOT NULL AND telefono IS NOT NULL;

COMMENT ON INDEX public.uniq_telefono_clienti_registrati IS
'Garantisce unicita'' del telefono come identificativo di login tra i clienti che hanno completato la registrazione.';

-- ---------------------------------------------------------
-- 6) RPC: risolvi_login_da_telefono
--    Restituisce l'email auth (vera o sintetica) per un telefono.
--    NULL se non trovato (no enumeration di esistenza).
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.risolvi_login_da_telefono(p_telefono text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_telefono text;
  v_email    text;
BEGIN
  v_telefono := public._normalize_phone_e164(p_telefono);
  IF v_telefono IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT u.email
    INTO v_email
    FROM public.clienti_stagionali cs
    JOIN auth.users u ON u.id = cs.user_id
   WHERE cs.telefono = v_telefono
     AND cs.user_id IS NOT NULL
   LIMIT 1;

  RETURN v_email; -- NULL se non trovato
END $$;

GRANT EXECUTE ON FUNCTION public.risolvi_login_da_telefono(text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.risolvi_login_da_telefono(text) IS
'Dato un telefono in qualsiasi formato, ritorna l''email su auth.users del cliente registrato corrispondente, oppure NULL. Usata dal form di login per consentire all''utente di accedere con telefono.';

-- ---------------------------------------------------------
-- 7) RPC: rigenera_invito_token
--    Permette al proprietario dello stabilimento di rigenerare
--    il token di invito di un cliente (per copiare un link
--    fresco da inviare manualmente).
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rigenera_invito_token(p_cliente_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid;
  v_stab_id  uuid;
  v_new_tok  uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Non autenticato';
  END IF;

  SELECT stabilimento_id
    INTO v_stab_id
    FROM public.clienti_stagionali
   WHERE id = p_cliente_id;

  IF v_stab_id IS NULL THEN
    RAISE EXCEPTION 'Cliente non trovato';
  END IF;

  -- Verifica che il chiamante sia il proprietario dello stabilimento
  IF NOT EXISTS (
    SELECT 1 FROM public.stabilimenti
     WHERE id = v_stab_id AND proprietario_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  v_new_tok := gen_random_uuid();
  UPDATE public.clienti_stagionali
     SET invito_token = v_new_tok,
         invitato_at  = NULL
   WHERE id = p_cliente_id;

  RETURN v_new_tok;
END $$;

GRANT EXECUTE ON FUNCTION public.rigenera_invito_token(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.rigenera_invito_token(uuid) IS
'Rigenera il token di invito di un cliente stagionale (solo proprietario dello stabilimento). Invalida il token precedente e resetta invitato_at a NULL.';
