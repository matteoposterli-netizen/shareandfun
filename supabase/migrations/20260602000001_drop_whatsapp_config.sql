-- Rimuove la tabella whatsapp_config: la Edge Function invia-whatsapp legge ora
-- Content SID e mittente dalle env var (TWILIO_WA_FROM, WA_SID_*), non più dal DB.
-- La tabella era diventata orfana dopo il redeploy della versione env-var.

DROP TABLE IF EXISTS public.whatsapp_config;
