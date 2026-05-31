-- WhatsApp: abilita notifiche automatiche per lo stabilimento.
-- Il proprietario attiva/disattiva dal sub-tab Configurazioni → WhatsApp.
-- Le credenziali Twilio (Account SID, Auth Token, From, Content SID dei
-- 3 template) sono a livello di piattaforma (env var della Edge Function).

ALTER TABLE public.stabilimenti
  ADD COLUMN IF NOT EXISTS wa_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stabilimenti.wa_enabled IS
  'Abilita notifiche WhatsApp automatiche (invito, benvenuto, sub-affitto) via Twilio.';
