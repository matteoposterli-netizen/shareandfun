-- Adds an optional, human-readable name to a booking so a manager can group
-- multi-day / multi-umbrella sub-rentals under a single label (e.g. guest name
-- or reservation code).
--
-- Nullable: existing and new rows without a name keep working.

ALTER TABLE public.disponibilita
  ADD COLUMN IF NOT EXISTS nome_prenotazione text;

CREATE INDEX IF NOT EXISTS idx_disponibilita_nome_prenotazione
  ON public.disponibilita (nome_prenotazione)
  WHERE nome_prenotazione IS NOT NULL;
