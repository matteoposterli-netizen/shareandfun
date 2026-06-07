-- Cambio scope dell'unique sul telefono dei clienti_stagionali:
-- da globale a per-stabilimento. Permette allo stesso utente di essere
-- cliente in piu' stabilimenti diversi con lo stesso numero di telefono,
-- mantenendo l'unicita' all'interno di un singolo stabilimento.
--
-- Applicato in produzione: 2026-06-07.

DROP INDEX IF EXISTS public.uniq_telefono_clienti_registrati;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_telefono_per_stabilimento_registrati
  ON public.clienti_stagionali (stabilimento_id, telefono)
  WHERE user_id IS NOT NULL AND telefono IS NOT NULL;
