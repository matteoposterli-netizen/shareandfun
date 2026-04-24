-- Allow stagionali to insert their own informational availability transactions.
--
-- The baseline `transazioni_insert` policy only granted INSERT to the
-- stabilimento owner. As a consequence, when a stagionale toggled a day on
-- their calendar (js/stagionale.js) the `disponibilita_aggiunta` /
-- `disponibilita_rimossa` transaction was silently rejected by RLS and the
-- manager never saw those events in their Transazioni tab.
--
-- The replacement policy keeps the owner path untouched and additionally
-- allows the stagionale to insert ONLY the two informational types for their
-- own cliente record, forbidding any monetary `importo`.

DROP POLICY IF EXISTS transazioni_insert ON public.transazioni;
CREATE POLICY transazioni_insert ON public.transazioni
  FOR INSERT WITH CHECK (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
    OR (
      tipo IN ('disponibilita_aggiunta', 'disponibilita_rimossa')
      AND importo IS NULL
      AND cliente_id IN (SELECT id FROM public.clienti_stagionali WHERE user_id = (SELECT auth.uid()))
    )
  );
