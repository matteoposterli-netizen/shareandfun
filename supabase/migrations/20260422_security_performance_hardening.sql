-- ============================================================
-- ShareAndFun — Hardening sicurezza + performance
--
-- Cosa fa:
--   1. Indici su tutte le FK non coperte
--   2. Policy RLS consolidate (una per tabella/comando) con
--      auth.uid() wrappata in (select auth.uid()) per performance
--   3. Sostituisce le policy "always true" su disponibilita e
--      transazioni con controlli di proprietà reali
--
-- Nota: drop + ricreazione policy è idempotente, safe da rieseguire.
-- ============================================================

-- ------------------------------------------------------------
-- 1. INDICI SU FOREIGN KEY
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clienti_stagionali_ombrellone_id   ON clienti_stagionali (ombrellone_id);
CREATE INDEX IF NOT EXISTS idx_clienti_stagionali_stabilimento_id ON clienti_stagionali (stabilimento_id);
CREATE INDEX IF NOT EXISTS idx_clienti_stagionali_user_id         ON clienti_stagionali (user_id);
CREATE INDEX IF NOT EXISTS idx_disponibilita_cliente_id           ON disponibilita       (cliente_id);
CREATE INDEX IF NOT EXISTS idx_ombrelloni_stabilimento_id         ON ombrelloni          (stabilimento_id);
CREATE INDEX IF NOT EXISTS idx_stabilimenti_proprietario_id       ON stabilimenti        (proprietario_id);
CREATE INDEX IF NOT EXISTS idx_transazioni_cliente_id             ON transazioni         (cliente_id);
CREATE INDEX IF NOT EXISTS idx_transazioni_ombrellone_id          ON transazioni         (ombrellone_id);
CREATE INDEX IF NOT EXISTS idx_transazioni_stabilimento_id        ON transazioni         (stabilimento_id);

-- ------------------------------------------------------------
-- 2. PROFILES — riscrittura policy con (select auth.uid())
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Utente può leggere il proprio profilo"    ON profiles;
DROP POLICY IF EXISTS "Utente può creare il proprio profilo"     ON profiles;
DROP POLICY IF EXISTS "Utente può aggiornare il proprio profilo" ON profiles;

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (id = (select auth.uid()));

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (id = (select auth.uid()));

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (id = (select auth.uid()))
              WITH CHECK (id = (select auth.uid()));

-- ------------------------------------------------------------
-- 3. STABILIMENTI — lettura pubblica + scrittura solo owner
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Tutti possono leggere stabilimenti"         ON stabilimenti;
DROP POLICY IF EXISTS "Proprietario gestisce il proprio stabilimento" ON stabilimenti;
DROP POLICY IF EXISTS "Autenticati vedono stabilimenti"            ON stabilimenti;

CREATE POLICY "stabilimenti_select" ON stabilimenti
  FOR SELECT USING (true);

CREATE POLICY "stabilimenti_insert" ON stabilimenti
  FOR INSERT WITH CHECK (proprietario_id = (select auth.uid()));

CREATE POLICY "stabilimenti_update" ON stabilimenti
  FOR UPDATE USING (proprietario_id = (select auth.uid()))
              WITH CHECK (proprietario_id = (select auth.uid()));

CREATE POLICY "stabilimenti_delete" ON stabilimenti
  FOR DELETE USING (proprietario_id = (select auth.uid()));

-- ------------------------------------------------------------
-- 4. OMBRELLONI — lettura pubblica + scrittura solo owner
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Tutti possono leggere ombrelloni"         ON ombrelloni;
DROP POLICY IF EXISTS "Proprietario gestisce i propri ombrelloni" ON ombrelloni;

CREATE POLICY "ombrelloni_select" ON ombrelloni
  FOR SELECT USING (true);

CREATE POLICY "ombrelloni_insert" ON ombrelloni
  FOR INSERT WITH CHECK (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );

CREATE POLICY "ombrelloni_update" ON ombrelloni
  FOR UPDATE USING (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  )
  WITH CHECK (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );

CREATE POLICY "ombrelloni_delete" ON ombrelloni
  FOR DELETE USING (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );

-- ------------------------------------------------------------
-- 5. CLIENTI_STAGIONALI — owner gestisce i suoi + stagionale il proprio
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Proprietario gestisce i propri clienti" ON clienti_stagionali;
DROP POLICY IF EXISTS "Stagionale può registrarsi"             ON clienti_stagionali;
DROP POLICY IF EXISTS "Stagionale legge il proprio record"     ON clienti_stagionali;
DROP POLICY IF EXISTS "Stagionale aggiorna il proprio record"  ON clienti_stagionali;

CREATE POLICY "clienti_stagionali_select" ON clienti_stagionali
  FOR SELECT USING (
    user_id = (select auth.uid())
    OR stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );

CREATE POLICY "clienti_stagionali_insert" ON clienti_stagionali
  FOR INSERT WITH CHECK (
    user_id = (select auth.uid())
    OR stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );

CREATE POLICY "clienti_stagionali_update" ON clienti_stagionali
  FOR UPDATE USING (
    user_id = (select auth.uid())
    OR stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  )
  WITH CHECK (
    user_id = (select auth.uid())
    OR stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );

CREATE POLICY "clienti_stagionali_delete" ON clienti_stagionali
  FOR DELETE USING (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );

-- ------------------------------------------------------------
-- 6. DISPONIBILITA — proprietario stabilimento + stagionale coinvolto
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Accesso disponibilità" ON disponibilita;

CREATE POLICY "disponibilita_select" ON disponibilita
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ombrelloni o
      JOIN stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id
        AND s.proprietario_id = (select auth.uid())
    )
    OR cliente_id IN (
      SELECT id FROM clienti_stagionali WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "disponibilita_insert" ON disponibilita
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM ombrelloni o
      JOIN stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id
        AND s.proprietario_id = (select auth.uid())
    )
    OR cliente_id IN (
      SELECT id FROM clienti_stagionali WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "disponibilita_update" ON disponibilita
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM ombrelloni o
      JOIN stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id
        AND s.proprietario_id = (select auth.uid())
    )
    OR cliente_id IN (
      SELECT id FROM clienti_stagionali WHERE user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ombrelloni o
      JOIN stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id
        AND s.proprietario_id = (select auth.uid())
    )
    OR cliente_id IN (
      SELECT id FROM clienti_stagionali WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "disponibilita_delete" ON disponibilita
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM ombrelloni o
      JOIN stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id
        AND s.proprietario_id = (select auth.uid())
    )
    OR cliente_id IN (
      SELECT id FROM clienti_stagionali WHERE user_id = (select auth.uid())
    )
  );

-- ------------------------------------------------------------
-- 7. TRANSAZIONI — scrittura solo proprietario, lettura anche stagionale
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Accesso transazioni" ON transazioni;

CREATE POLICY "transazioni_select" ON transazioni
  FOR SELECT USING (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
    OR cliente_id IN (
      SELECT id FROM clienti_stagionali WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "transazioni_insert" ON transazioni
  FOR INSERT WITH CHECK (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );

CREATE POLICY "transazioni_update" ON transazioni
  FOR UPDATE USING (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  )
  WITH CHECK (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );

CREATE POLICY "transazioni_delete" ON transazioni
  FOR DELETE USING (
    stabilimento_id IN (
      SELECT id FROM stabilimenti WHERE proprietario_id = (select auth.uid())
    )
  );
