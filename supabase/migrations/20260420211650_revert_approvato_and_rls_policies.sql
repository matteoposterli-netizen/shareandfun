ALTER TABLE clienti_stagionali DROP COLUMN IF EXISTS approvato;

DROP POLICY IF EXISTS "Stagionale può registrarsi" ON clienti_stagionali;
DROP POLICY IF EXISTS "Stagionale legge il proprio record" ON clienti_stagionali;
DROP POLICY IF EXISTS "Stagionale aggiorna il proprio record" ON clienti_stagionali;
DROP POLICY IF EXISTS "Autenticati vedono stabilimenti" ON stabilimenti;
