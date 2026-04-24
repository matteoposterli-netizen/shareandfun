-- Add transaction types for sub-rental cancellation:
-- - sub_affitto_annullato: one per (ombrellone, giorno) when a booking is cancelled
-- - credito_revocato: one per (cliente, ombrellone, giorno) to reverse a credito_ricevuto
--
-- RLS: transazioni_insert already accepts any tipo when the actor owns the
-- stabilimento; the stagionale exception list (disponibilita_aggiunta/rimossa)
-- is unchanged, so the policy does not need to be redefined.
--
-- credito_saldo stays numeric(8,2) with no CHECK: negative balances are
-- intentionally permitted when a cancellation revokes credit the client has
-- already spent.

ALTER TABLE public.transazioni
  DROP CONSTRAINT transazioni_tipo_check;

ALTER TABLE public.transazioni
  ADD CONSTRAINT transazioni_tipo_check CHECK (
    tipo = ANY (ARRAY[
      'disponibilita_aggiunta'::text,
      'disponibilita_rimossa'::text,
      'sub_affitto'::text,
      'sub_affitto_annullato'::text,
      'credito_ricevuto'::text,
      'credito_usato'::text,
      'credito_revocato'::text
    ])
  );
