-- Migration: Panoramica Deep Dive (Consegna 1)
-- Date: 2026-04-25
-- Purpose: Add città to stabilimenti (for breadcrumb), categoria to transazioni
-- (for "dove spendono" pie chart), plus an index for KPI range queries.

BEGIN;

-- 1) stabilimenti.citta (nullable; breadcrumb falls back when NULL)
ALTER TABLE public.stabilimenti
  ADD COLUMN IF NOT EXISTS citta text;

COMMENT ON COLUMN public.stabilimenti.citta IS
  'Città dello stabilimento (usata per breadcrumb nella Panoramica manager). Nullable.';

-- 2) transazioni.categoria (solo per credito_usato: dove è stato speso)
ALTER TABLE public.transazioni
  ADD COLUMN IF NOT EXISTS categoria text;

ALTER TABLE public.transazioni
  DROP CONSTRAINT IF EXISTS transazioni_categoria_check;

ALTER TABLE public.transazioni
  ADD CONSTRAINT transazioni_categoria_check
  CHECK (categoria IS NULL OR categoria IN ('bar','ristorante','altro'));

COMMENT ON COLUMN public.transazioni.categoria IS
  'Dove è stato speso il credito. Valori: bar | ristorante | altro. Popolato solo per tipo=credito_usato; NULL altrove.';

-- 3) Indice di copertura per le query KPI range sulla Panoramica
--    (filtrano per stabilimento_id + tipo e un range created_at)
CREATE INDEX IF NOT EXISTS idx_transazioni_stab_tipo_created
  ON public.transazioni (stabilimento_id, tipo, created_at DESC);

COMMIT;
