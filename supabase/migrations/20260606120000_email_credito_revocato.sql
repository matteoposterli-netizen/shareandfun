-- Aggiunge 2 colonne per customizzare il template email "credito revocato"
-- (annullamento/modifica prenotazione). Stesso pattern delle altre email
-- (oggetto + testo nullable; quando NULL viene usato il default in
-- js/email.js → DEFAULT_EMAIL_TEMPLATES e nel fallback dentro l'Edge Function
-- invia-email/index.ts).
ALTER TABLE public.stabilimenti
  ADD COLUMN IF NOT EXISTS email_credito_revocato_oggetto text,
  ADD COLUMN IF NOT EXISTS email_credito_revocato_testo   text;
