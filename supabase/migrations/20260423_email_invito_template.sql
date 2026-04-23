-- Aggiunge colonne per template email "invito" personalizzabile dal proprietario
-- (oggetto + testo introduttivo). Se NULL, la Edge Function `invia-email`
-- ricade sul testo di default.

ALTER TABLE public.stabilimenti
  ADD COLUMN IF NOT EXISTS email_invito_oggetto text,
  ADD COLUMN IF NOT EXISTS email_invito_testo   text;
