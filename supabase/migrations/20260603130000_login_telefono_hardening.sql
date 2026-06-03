-- ============================================================
-- LOGIN EMAIL/TELEFONO - HARDENING POST-ADVISOR (FASE 1)
-- ============================================================
-- Follow-up di sicurezza/igiene dati sugli oggetti introdotti da
-- 20260603120000_login_email_o_telefono.sql, in risposta agli
-- advisor Supabase:
--  1) Pin di search_path sui due helper (risolve il WARN
--     function_search_path_mutable).
--  2) REVOKE EXECUTE da PUBLIC su rigenera_invito_token: solo
--     authenticated puo' chiamarla (difesa in profondita';
--     resta comunque protetta dai check interni auth.uid()).
--  3) Pulizia dati: i telefoni stringa-vuota ('') diventano NULL,
--     coerente con la logica del trigger trg_clienti_normalize_phone
--     (che converte gia' '' -> NULL su ogni scrittura).
-- ============================================================

-- ---------------------------------------------------------
-- 1) search_path esplicito sugli helper
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._normalize_phone_e164(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
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

CREATE OR REPLACE FUNCTION public._clienti_stagionali_norm_phone_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.telefono IS NOT NULL THEN
    NEW.telefono := public._normalize_phone_e164(NEW.telefono);
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------
-- 2) Restringe rigenera_invito_token al solo ruolo authenticated
-- ---------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rigenera_invito_token(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rigenera_invito_token(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rigenera_invito_token(uuid) TO authenticated;

-- ---------------------------------------------------------
-- 3) Pulizia telefoni stringa-vuota -> NULL
-- ---------------------------------------------------------
UPDATE public.clienti_stagionali
SET telefono = NULL
WHERE telefono = '';
