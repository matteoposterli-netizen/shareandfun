-- Colonna approvazione su clienti_stagionali
ALTER TABLE clienti_stagionali ADD COLUMN IF NOT EXISTS approvato boolean NOT NULL DEFAULT false;

-- Stagionale può inserire la propria registrazione
CREATE POLICY "Stagionale può registrarsi" ON clienti_stagionali
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Stagionale può leggere il proprio record
CREATE POLICY "Stagionale legge il proprio record" ON clienti_stagionali
  FOR SELECT USING (user_id = auth.uid());

-- Stagionale può aggiornare il proprio record (es. telefono)
CREATE POLICY "Stagionale aggiorna il proprio record" ON clienti_stagionali
  FOR UPDATE USING (user_id = auth.uid());

-- Tutti gli utenti autenticati possono leggere la lista degli stabilimenti (per dropdown registrazione)
CREATE POLICY "Autenticati vedono stabilimenti" ON stabilimenti
  FOR SELECT USING (auth.role() = 'authenticated');
