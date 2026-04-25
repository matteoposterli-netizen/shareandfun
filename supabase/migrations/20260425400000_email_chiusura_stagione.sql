-- Template email per la chiusura della stagione (inviata dal proprietario
-- a tutti i clienti registrati prima del reset stagione).
-- Nuove colonne opzionali su stabilimenti (fallback ai default nel codice).

ALTER TABLE public.stabilimenti
  ADD COLUMN IF NOT EXISTS email_chiusura_stagione_oggetto text,
  ADD COLUMN IF NOT EXISTS email_chiusura_stagione_testo   text;
