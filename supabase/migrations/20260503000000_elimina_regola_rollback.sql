-- ============================================================
-- elimina_regola_stato: rollback dei side-effect su disponibilita
-- ============================================================
--
-- Comportamento precedente: l'eliminazione della regola NON ripristinava
-- lo stato `disponibilita`. In pratica le righe `libero` inserite da una
-- `sempre_libero` restavano (l'ombrellone con cliente continuava a
-- mostrarsi subaffittabile anche dopo aver tolto la regola).
--
-- Nuovo comportamento (richiesto dal proprietario):
--   • sempre_libero  → DELETE delle righe `libero` nel range della regola
--                      per gli ombrelloni dello stabilimento. I sub-affitti
--                      già confermati (`stato='sub_affittato'`) non vengono
--                      toccati. Per gli ombrelloni senza cliente assegnato
--                      la chiamata successiva a `_materialize_default_libero`
--                      ripristina la default-libero.
--   • mai_libero     → niente da DELETEare; chiamiamo solo
--                      `_materialize_default_libero` sui senza-cliente
--                      così quei giorni tornano subaffittabili di default.
--   • chiusura_speciale → i sub-affitti annullati restano cancellati
--                      (sono già stati rimborsati nel ledger). Stessa
--                      ri-materializzazione default-libero sui senza-cliente.
--
-- audit.batch_tag impostato per sopprimere il rumore audit del DELETE bulk;
-- l'evento "regola eliminata" resta tracciato dal trigger della tabella
-- `regole_stato_ombrelloni` e dalle transazioni `regola_forzata_rimossa`.
-- ============================================================

CREATE OR REPLACE FUNCTION public.elimina_regola_stato(p_regola_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid       uuid := (SELECT auth.uid());
  v_rule      record;
  v_label     text;
  v_range_fmt text;
  v_cs        record;
  v_omb       record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  SELECT r.id, r.stabilimento_id, r.tipo, r.data_da, r.data_a, r.nota
    INTO v_rule
  FROM public.regole_stato_ombrelloni r
  WHERE r.id = p_regola_id;

  IF v_rule.id IS NULL THEN
    RAISE EXCEPTION 'Regola non trovata';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stabilimenti
    WHERE id = v_rule.stabilimento_id AND proprietario_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  v_label := CASE v_rule.tipo
    WHEN 'chiusura_speciale' THEN 'Chiusura speciale'
    WHEN 'sempre_libero'     THEN 'Sempre subaffittabile'
    WHEN 'mai_libero'        THEN 'Mai subaffittabile'
  END;

  IF v_rule.data_da = v_rule.data_a THEN
    v_range_fmt := to_char(v_rule.data_da, 'DD/MM/YYYY');
  ELSE
    v_range_fmt := 'dal ' || to_char(v_rule.data_da, 'DD/MM/YYYY')
                || ' al '  || to_char(v_rule.data_a,  'DD/MM/YYYY');
  END IF;

  -- 1. Rimuovi la regola
  DELETE FROM public.regole_stato_ombrelloni WHERE id = p_regola_id;

  -- 2. Rollback dei side-effect su disponibilita
  PERFORM set_config('audit.batch_tag', 'elimina_regola_' || p_regola_id::text, true);

  IF v_rule.tipo = 'sempre_libero' THEN
    DELETE FROM public.disponibilita d
     USING public.ombrelloni o
     WHERE o.id = d.ombrellone_id
       AND o.stabilimento_id = v_rule.stabilimento_id
       AND d.data BETWEEN v_rule.data_da AND v_rule.data_a
       AND d.stato = 'libero';
  END IF;

  -- Per ogni ombrellone senza cliente assegnato, ri-materializza
  -- la default-libero (rispetta mai_libero/chiusura_speciale residue).
  FOR v_omb IN
    SELECT o.id
      FROM public.ombrelloni o
     WHERE o.stabilimento_id = v_rule.stabilimento_id
       AND NOT EXISTS (
         SELECT 1 FROM public.clienti_stagionali c
          WHERE c.ombrellone_id = o.id AND NOT c.rifiutato
       )
  LOOP
    PERFORM public._materialize_default_libero(v_omb.id);
  END LOOP;

  PERFORM set_config('audit.batch_tag', '', true);

  -- 3. Notifica aggregata ai clienti stagionali con ombrellone
  FOR v_cs IN
    SELECT id, ombrellone_id
    FROM public.clienti_stagionali
    WHERE stabilimento_id = v_rule.stabilimento_id
      AND ombrellone_id IS NOT NULL
  LOOP
    INSERT INTO public.transazioni
      (stabilimento_id, ombrellone_id, cliente_id, tipo, importo, nota)
    VALUES (
      v_rule.stabilimento_id,
      v_cs.ombrellone_id,
      v_cs.id,
      'regola_forzata_rimossa',
      0,
      v_label || ' revocata dal proprietario · ' || v_range_fmt
    );
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.elimina_regola_stato(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.elimina_regola_stato(uuid) TO authenticated;
