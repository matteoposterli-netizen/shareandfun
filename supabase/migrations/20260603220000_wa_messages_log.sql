-- Log dei messaggi WhatsApp inviati via Twilio, con status aggiornato dal
-- webhook twilio-wa-status-webhook (configurato in StatusCallback su ogni
-- chiamata da invia-whatsapp). Permette al manager di vedere se un WA e'
-- davvero stato consegnato al cliente, non solo accettato da Twilio.

CREATE TABLE IF NOT EXISTS public.wa_messages_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_sid text UNIQUE NOT NULL,
  stabilimento_id uuid REFERENCES public.stabilimenti(id) ON DELETE SET NULL,
  cliente_id uuid REFERENCES public.clienti_stagionali(id) ON DELETE SET NULL,
  tipo text NOT NULL,
  to_number text NOT NULL,
  -- Status Twilio: queued | sent | delivered | read | failed | undelivered
  status text NOT NULL DEFAULT 'queued',
  error_code int,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_messages_log_stabilimento_created
  ON public.wa_messages_log(stabilimento_id, created_at DESC);

CREATE INDEX idx_wa_messages_log_cliente_created
  ON public.wa_messages_log(cliente_id, created_at DESC);

CREATE INDEX idx_wa_messages_log_status
  ON public.wa_messages_log(status) WHERE status IN ('failed', 'undelivered');

ALTER TABLE public.wa_messages_log ENABLE ROW LEVEL SECURITY;

-- Manager puo' leggere solo i log dei propri stabilimenti.
CREATE POLICY "wa_messages_log_select_owner" ON public.wa_messages_log
  FOR SELECT TO authenticated
  USING (
    stabilimento_id IN (
      SELECT id FROM public.stabilimenti WHERE proprietario_id = auth.uid()
    )
  );

-- INSERT e UPDATE solo da service_role (Edge Functions invia-whatsapp
-- e twilio-wa-status-webhook). Niente policy per i manager: bypass via RLS.

COMMENT ON TABLE public.wa_messages_log IS
  'Log dei WhatsApp inviati via Twilio. Status aggiornato dal webhook quando Twilio notifica delivery.';
