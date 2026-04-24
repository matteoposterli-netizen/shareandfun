-- Stagione balneare: data inizio/fine per ogni stabilimento.
-- Usato da:
--   • Tab "Configurazioni → Stagione" (sidebar manager)
--   • Range picker della Panoramica (preset "Stagione")
--
-- Default ragionevoli: 1 giugno → 15 settembre dell'anno corrente.
-- Se l'anno corrente è già passato il 15 settembre, il proprietario
-- aggiornerà manualmente le date dall'UI.

ALTER TABLE public.stabilimenti
  ADD COLUMN IF NOT EXISTS data_inizio_stagione date
    DEFAULT (date_trunc('year', now()) + interval '5 months')::date,
  ADD COLUMN IF NOT EXISTS data_fine_stagione date
    DEFAULT (date_trunc('year', now()) + interval '8 months 14 days')::date;

-- Backfill per gli stabilimenti esistenti (se NULL, applica il default).
UPDATE public.stabilimenti
SET data_inizio_stagione = (date_trunc('year', now()) + interval '5 months')::date
WHERE data_inizio_stagione IS NULL;

UPDATE public.stabilimenti
SET data_fine_stagione = (date_trunc('year', now()) + interval '8 months 14 days')::date
WHERE data_fine_stagione IS NULL;

-- Constraint di coerenza: fine >= inizio.
ALTER TABLE public.stabilimenti
  DROP CONSTRAINT IF EXISTS stabilimenti_stagione_range_check;

ALTER TABLE public.stabilimenti
  ADD CONSTRAINT stabilimenti_stagione_range_check
  CHECK (data_fine_stagione IS NULL OR data_inizio_stagione IS NULL OR data_fine_stagione >= data_inizio_stagione);

COMMENT ON COLUMN public.stabilimenti.data_inizio_stagione IS
  'Primo giorno della stagione balneare (inclusivo). Usato per filtri Panoramica e barra progressione.';
COMMENT ON COLUMN public.stabilimenti.data_fine_stagione IS
  'Ultimo giorno della stagione balneare (inclusivo). Usato per filtri Panoramica e barra progressione.';
