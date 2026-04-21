-- ============================================================
-- ShareAndFun — Migrazione: sistema registrazione + email
-- Esegui questo script nel Supabase SQL Editor
-- ============================================================

-- 1. Colonne aggiuntive su clienti_stagionali
ALTER TABLE clienti_stagionali
  ADD COLUMN IF NOT EXISTS approvato       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rifiutato       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fonte           text        NOT NULL DEFAULT 'csv'
    CHECK (fonte IN ('csv', 'diretta')),
  ADD COLUMN IF NOT EXISTS invito_token    uuid        DEFAULT gen_random_uuid() UNIQUE,
  ADD COLUMN IF NOT EXISTS invitato_at     timestamptz,
  ADD COLUMN IF NOT EXISTS note_match      text;

-- 2. Colonne aggiuntive su stabilimenti (email + template email)
ALTER TABLE stabilimenti
  ADD COLUMN IF NOT EXISTS email                       text,
  ADD COLUMN IF NOT EXISTS email_benvenuto_oggetto     text DEFAULT 'Benvenuto su ShareAndFun!',
  ADD COLUMN IF NOT EXISTS email_benvenuto_testo       text DEFAULT 'Siamo felici di averti con noi! Il tuo accesso è attivo.',
  ADD COLUMN IF NOT EXISTS email_attesa_oggetto        text DEFAULT 'Richiesta di iscrizione ricevuta',
  ADD COLUMN IF NOT EXISTS email_attesa_testo          text DEFAULT 'La tua richiesta è stata ricevuta. Il proprietario la esaminerà a breve.',
  ADD COLUMN IF NOT EXISTS email_approvazione_oggetto  text DEFAULT 'Iscrizione approvata!',
  ADD COLUMN IF NOT EXISTS email_approvazione_testo    text DEFAULT 'Ottima notizia! La tua iscrizione è stata approvata. Puoi ora accedere alla piattaforma.';

-- 3. RLS policy: stagionale può inserire il proprio record (registrazione diretta)
CREATE POLICY "Stagionale può registrarsi" ON clienti_stagionali
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 4. RLS policy: stagionale legge il proprio record
CREATE POLICY "Stagionale legge il proprio record" ON clienti_stagionali
  FOR SELECT USING (user_id = auth.uid());

-- 5. RLS policy: stagionale aggiorna il proprio record
CREATE POLICY "Stagionale aggiorna il proprio record" ON clienti_stagionali
  FOR UPDATE USING (user_id = auth.uid());

-- 6. RLS policy: tutti gli autenticati leggono la lista stabilimenti (per dropdown)
CREATE POLICY "Autenticati vedono stabilimenti" ON stabilimenti
  FOR SELECT USING (auth.role() = 'authenticated');

-- 7. Funzione RPC: recupera dati cliente da token invito (bypass RLS, solo lettura)
CREATE OR REPLACE FUNCTION get_cliente_by_invito_token(p_token uuid)
RETURNS TABLE (
  id              uuid,
  nome            text,
  cognome         text,
  email           text,
  telefono        text,
  stabilimento_id uuid,
  stabilimento_nome text,
  ombrellone_id   uuid,
  ombrellone_fila text,
  ombrellone_numero integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.id, cs.nome, cs.cognome, cs.email, cs.telefono,
    cs.stabilimento_id,
    s.nome  AS stabilimento_nome,
    cs.ombrellone_id,
    o.fila  AS ombrellone_fila,
    o.numero AS ombrellone_numero
  FROM clienti_stagionali cs
  LEFT JOIN stabilimenti s ON s.id = cs.stabilimento_id
  LEFT JOIN ombrelloni   o ON o.id = cs.ombrellone_id
  WHERE cs.invito_token = p_token
    AND cs.user_id IS NULL
    AND cs.rifiutato = false
  LIMIT 1;
END;
$$;

-- 8. Funzione RPC: completa registrazione via invito (bypass RLS)
CREATE OR REPLACE FUNCTION completa_registrazione_invito(p_token uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows_updated integer;
BEGIN
  UPDATE clienti_stagionali
  SET user_id   = p_user_id,
      approvato = true,
      fonte     = 'csv'          -- rimane csv: era stato invitato dall'owner
  WHERE invito_token = p_token
    AND user_id IS NULL;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;
