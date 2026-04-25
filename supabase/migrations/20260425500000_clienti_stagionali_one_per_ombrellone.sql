-- ============================================================
-- Garantisce un solo cliente stagionale assegnato per ombrellone.
--
-- Senza vincolo, race condition, edit dall'area admin o flussi
-- legacy potevano lasciare 2+ righe in `clienti_stagionali` con
-- lo stesso `ombrellone_id`. Le UI del proprietario assumono 1
-- cliente per ombrellone e si comportano in modo inconsistente
-- in caso di duplicati (renderGestioneFiltered tiene l'ultimo
-- iterato, populateEditRowFromData il primo) — il badge stato
-- invito puo' anche divergere dalla riga inviata.
--
-- 1) CLEANUP duplicati esistenti: per ogni ombrellone_id con piu'
--    di 1 cliente assegnato, mantiene il piu' recente per
--    created_at (poi id come tie-breaker deterministico) e setta
--    `ombrellone_id = NULL` sugli altri. Anagrafica cliente,
--    saldo, transazioni e disponibilita' restano intatti — solo
--    l'assegnazione all'ombrellone viene rimossa.
-- 2) UNIQUE INDEX parziale su `ombrellone_id` WHERE NOT NULL per
--    impedire futuri duplicati. NULL ombrellone_id resta ammesso
--    su piu' righe (clienti non ancora assegnati a un ombrellone).
-- ============================================================

BEGIN;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY ombrellone_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
    FROM public.clienti_stagionali
   WHERE ombrellone_id IS NOT NULL
)
UPDATE public.clienti_stagionali cs
   SET ombrellone_id = NULL
  FROM ranked
 WHERE cs.id = ranked.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS clienti_stagionali_ombrellone_unique
  ON public.clienti_stagionali (ombrellone_id)
  WHERE ombrellone_id IS NOT NULL;

COMMIT;
