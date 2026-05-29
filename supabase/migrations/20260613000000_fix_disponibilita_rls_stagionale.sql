-- Fix: stagionale clients can now see all disponibilita for their assigned ombrellone,
-- including records with cliente_id=NULL (default-libero records materialized by the DB trigger).
-- Previously the SELECT policy only matched rows where cliente_id = the client's id,
-- making 5000+ default-libero rows invisible and causing the calendar to appear empty.

DROP POLICY IF EXISTS disponibilita_select ON public.disponibilita;

CREATE POLICY disponibilita_select ON public.disponibilita
  FOR SELECT USING (
    -- Owner sees all records for their stabilimento
    EXISTS (
      SELECT 1 FROM public.ombrelloni o
      JOIN public.stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id AND s.proprietario_id = (SELECT auth.uid())
    )
    -- Stagionale sees records explicitly assigned to them
    OR cliente_id IN (SELECT id FROM public.clienti_stagionali WHERE user_id = (SELECT auth.uid()))
    -- Stagionale sees ALL records for their assigned ombrellone (incl. cliente_id=NULL)
    OR ombrellone_id IN (
      SELECT ombrellone_id FROM public.clienti_stagionali
      WHERE user_id = (SELECT auth.uid()) AND ombrellone_id IS NOT NULL
    )
  );
