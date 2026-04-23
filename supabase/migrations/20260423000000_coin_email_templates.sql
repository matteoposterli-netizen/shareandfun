-- Template email per notifiche di accredito/utilizzo coin al cliente stagionale.
-- Nuove colonne opzionali su stabilimenti (fallback ai default nel codice).

ALTER TABLE public.stabilimenti
  ADD COLUMN IF NOT EXISTS email_credito_accreditato_oggetto text,
  ADD COLUMN IF NOT EXISTS email_credito_accreditato_testo   text,
  ADD COLUMN IF NOT EXISTS email_credito_ritirato_oggetto    text,
  ADD COLUMN IF NOT EXISTS email_credito_ritirato_testo      text;
