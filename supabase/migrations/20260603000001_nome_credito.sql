-- Aggiunge colonna nome_credito a stabilimenti per permettere al gestore
-- di personalizzare il nome del sistema di crediti (default: 'Crediti').
-- La colonna è già applicata in produzione tramite ALTER TABLE diretto.
ALTER TABLE stabilimenti
  ADD COLUMN IF NOT EXISTS nome_credito TEXT NOT NULL DEFAULT 'Crediti';
