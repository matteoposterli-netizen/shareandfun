-- WhatsApp: consenso esplicito del cliente stagionale a ricevere notifiche via WhatsApp.
-- Opt-in richiesto da Meta. Il numero destinatario usa il campo `telefono` esistente.

ALTER TABLE public.clienti_stagionali
  ADD COLUMN IF NOT EXISTS whatsapp_consenso    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_consenso_at timestamptz;

COMMENT ON COLUMN public.clienti_stagionali.whatsapp_consenso IS
  'Opt-in del cliente a ricevere notifiche WhatsApp (richiesto da Meta).';
COMMENT ON COLUMN public.clienti_stagionali.whatsapp_consenso_at IS
  'Timestamp del consenso WhatsApp, per audit/compliance.';
