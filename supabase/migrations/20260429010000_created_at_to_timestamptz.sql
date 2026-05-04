-- Convert business `created_at` columns from naive `timestamp` to `timestamptz`.
--
-- Problema: il baseline ha definito `created_at` come `timestamp` (senza time
-- zone) sulle 6 tabelle business. PostgREST serializza i valori senza marker
-- TZ (es. `2026-04-29T13:08:00`), quindi il browser li interpreta come ora
-- locale invece che UTC. Risultato: `formatDateShort` mostra l'orario -2h in
-- estate (CEST) e -1h in inverno (CET) rispetto al reale.
--
-- Fix: convertire le colonne a `timestamptz`. I valori esistenti sono stati
-- scritti da Postgres `now()` in sessioni con timezone UTC (default Supabase),
-- quindi rappresentano già UTC; aggiungiamo l'offset esplicitamente con
-- `AT TIME ZONE 'UTC'`. Le tabelle aggiunte dopo il baseline (audit_log,
-- regole_stato_ombrelloni, stagioni_backup, email_bozze, admins) sono già
-- timestamptz e non vanno toccate.
--
-- L'ALTER COLUMN TYPE con USING provoca una rewrite della tabella; gli indici
-- su created_at vengono rebuiltati automaticamente. Su SpiaggiaMia il volume
-- è piccolo e l'operazione è veloce.

ALTER TABLE public.profiles
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.stabilimenti
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.ombrelloni
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.clienti_stagionali
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.disponibilita
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.transazioni
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DEFAULT now();
