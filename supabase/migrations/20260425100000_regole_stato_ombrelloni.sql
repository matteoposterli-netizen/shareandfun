-- Regole di stato forzato per ombrelloni di uno stabilimento.
--
-- Permette al proprietario di sovrascrivere il comportamento di default del
-- calendario per un range di date specifico. La "chiusura stagionale" è
-- derivata automaticamente dalle date stabilimenti.data_*_stagione e NON
-- è una riga in questa tabella.
--
-- Tipi:
--   • chiusura_speciale  — bagno chiuso (es. ferragosto, manutenzione,
--     maltempo). Cliente stagionale non può dichiarare libero, e i
--     sub-affitti esistenti nel range vengono annullati automaticamente
--     (rimborso credito gestito da public.cancel_booking).
--   • sempre_libero      — ombrelloni forzati subaffittabili. Cliente
--     stagionale non può ritirare/bloccare la disponibilità.
--   • mai_libero         — cliente stagionale non può dichiarare libero
--     (es. weekend gestiti a mano dal proprietario). Bagno aperto.
--
-- Granularità: stabilimento (tutti gli ombrelloni). Più regole possono
-- sovrapporsi nel range; la precedenza viene risolta lato applicazione.

CREATE TABLE IF NOT EXISTS public.regole_stato_ombrelloni (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stabilimento_id uuid NOT NULL REFERENCES public.stabilimenti(id) ON DELETE CASCADE,
  tipo            text NOT NULL,
  data_da         date NOT NULL,
  data_a          date NOT NULL,
  nota            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT regole_stato_ombrelloni_tipo_check
    CHECK (tipo = ANY (ARRAY['chiusura_speciale','sempre_libero','mai_libero'])),
  CONSTRAINT regole_stato_ombrelloni_range_check
    CHECK (data_a >= data_da)
);

CREATE INDEX IF NOT EXISTS idx_regole_stato_stab_data
  ON public.regole_stato_ombrelloni (stabilimento_id, data_da, data_a);

ALTER TABLE public.regole_stato_ombrelloni ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS regole_stato_select ON public.regole_stato_ombrelloni;
DROP POLICY IF EXISTS regole_stato_insert ON public.regole_stato_ombrelloni;
DROP POLICY IF EXISTS regole_stato_update ON public.regole_stato_ombrelloni;
DROP POLICY IF EXISTS regole_stato_delete ON public.regole_stato_ombrelloni;

-- Proprietario: full CRUD sulle regole del proprio stabilimento.
-- Stagionale: solo SELECT (serve al calendario per disabilitare i giorni).
CREATE POLICY regole_stato_select ON public.regole_stato_ombrelloni
  FOR SELECT USING (
    stabilimento_id IN (
      SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid())
    )
    OR stabilimento_id IN (
      SELECT stabilimento_id FROM public.clienti_stagionali WHERE user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY regole_stato_insert ON public.regole_stato_ombrelloni
  FOR INSERT WITH CHECK (
    stabilimento_id IN (
      SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid())
    )
  );
CREATE POLICY regole_stato_update ON public.regole_stato_ombrelloni
  FOR UPDATE USING (
    stabilimento_id IN (
      SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    stabilimento_id IN (
      SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid())
    )
  );
CREATE POLICY regole_stato_delete ON public.regole_stato_ombrelloni
  FOR DELETE USING (
    stabilimento_id IN (
      SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid())
    )
  );

-- Admin: full access per coerenza con le altre tabelle business.
DROP POLICY IF EXISTS regole_stato_admin_select ON public.regole_stato_ombrelloni;
DROP POLICY IF EXISTS regole_stato_admin_insert ON public.regole_stato_ombrelloni;
DROP POLICY IF EXISTS regole_stato_admin_update ON public.regole_stato_ombrelloni;
DROP POLICY IF EXISTS regole_stato_admin_delete ON public.regole_stato_ombrelloni;
CREATE POLICY regole_stato_admin_select ON public.regole_stato_ombrelloni
  FOR SELECT USING (public.is_admin((SELECT auth.uid())));
CREATE POLICY regole_stato_admin_insert ON public.regole_stato_ombrelloni
  FOR INSERT WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY regole_stato_admin_update ON public.regole_stato_ombrelloni
  FOR UPDATE USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));
CREATE POLICY regole_stato_admin_delete ON public.regole_stato_ombrelloni
  FOR DELETE USING (public.is_admin((SELECT auth.uid())));

-- ============================================================
-- Estendi i tipi di transazione per le notifiche aggregate
-- ============================================================

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
      'credito_revocato'::text,
      'regola_forzata_aggiunta'::text,
      'regola_forzata_rimossa'::text
    ])
  );

-- ============================================================
-- Audit log: aggiungi 'regola_stato' a entity_type, aggiorna il
-- trigger generico e attaccalo alla nuova tabella.
-- ============================================================

ALTER TABLE public.audit_log
  DROP CONSTRAINT audit_log_entity_type_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check CHECK (
    entity_type = ANY (ARRAY[
      'transazione','disponibilita','cliente_stagionale',
      'ombrellone','stabilimento','profile',
      'email','auth','import','regola_stato'
    ])
  );

-- Trigger generico: aggiungi 'regola_stato' al ramo che legge
-- stabilimento_id direttamente dalla riga.
CREATE OR REPLACE FUNCTION public._audit_row_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_entity_type text;
  v_action      text;
  v_stab_id     uuid;
  v_entity_id   uuid;
  v_before      jsonb;
  v_after       jsonb;
  v_diff        jsonb;
  v_actor       record;
  v_desc        text;
  v_batch_tag   text;
BEGIN
  BEGIN
    v_batch_tag := current_setting('audit.batch_tag', true);
  EXCEPTION WHEN OTHERS THEN
    v_batch_tag := NULL;
  END;
  IF v_batch_tag IS NOT NULL AND v_batch_tag <> '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_entity_type := TG_ARGV[0];
  v_action      := lower(TG_OP);

  IF v_action = 'delete' THEN
    v_before    := to_jsonb(OLD);
    v_after     := NULL;
    v_entity_id := (OLD).id;
  ELSIF v_action = 'insert' THEN
    v_before    := NULL;
    v_after     := to_jsonb(NEW);
    v_entity_id := (NEW).id;
  ELSE
    v_before    := to_jsonb(OLD);
    v_after     := to_jsonb(NEW);
    v_entity_id := (NEW).id;
    v_diff      := public._audit_json_diff(v_before, v_after);
    IF v_diff IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_entity_type IN ('transazione','cliente_stagionale','ombrellone','regola_stato') THEN
    v_stab_id := COALESCE((v_after ->> 'stabilimento_id')::uuid, (v_before ->> 'stabilimento_id')::uuid);
  ELSIF v_entity_type = 'stabilimento' THEN
    v_stab_id := COALESCE((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid);
  ELSIF v_entity_type = 'disponibilita' THEN
    v_stab_id := public._audit_stab_from_ombrellone(
      COALESCE((v_after ->> 'ombrellone_id')::uuid, (v_before ->> 'ombrellone_id')::uuid)
    );
  ELSIF v_entity_type = 'profile' THEN
    v_stab_id := public._audit_stab_from_profile(
      COALESCE((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid)
    );
  END IF;

  IF v_stab_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_entity_type = 'stabilimento' AND v_action = 'delete' THEN
    RETURN OLD;
  END IF;

  SELECT * INTO v_actor FROM public._audit_current_actor();
  v_desc := public._audit_describe(v_entity_type, v_action, v_before, v_after, v_diff);

  INSERT INTO public.audit_log (
    stabilimento_id, actor_type, actor_id, actor_label,
    entity_type, entity_id, action, before, after, diff, description
  ) VALUES (
    v_stab_id, v_actor.actor_type, v_actor.actor_id, v_actor.actor_label,
    v_entity_type, v_entity_id, v_action, v_before, v_after, v_diff, v_desc
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Estendi _audit_describe con il caso 'regola_stato'.
CREATE OR REPLACE FUNCTION public._audit_describe(
  p_entity text, p_action text, p_before jsonb, p_after jsonb, p_diff jsonb
) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
  v_desc text;
  v_row  jsonb := COALESCE(p_after, p_before);
  v_keys text;
  v_tipo_label text;
  v_range text;
BEGIN
  IF p_entity = 'transazione' THEN
    IF p_action = 'insert' THEN
      v_desc := 'Transazione ' || COALESCE(v_row ->> 'tipo','?') ||
                ' · importo ' || COALESCE(v_row ->> 'importo','0') ||
                CASE WHEN v_row ->> 'nota' IS NOT NULL AND v_row ->> 'nota' <> ''
                     THEN ' · ' || (v_row ->> 'nota') ELSE '' END;
    ELSIF p_action = 'delete' THEN
      v_desc := 'Transazione eliminata (' || COALESCE(v_row ->> 'tipo','?') || ')';
    ELSE
      v_desc := 'Transazione modificata';
    END IF;

  ELSIF p_entity = 'disponibilita' THEN
    IF p_action = 'insert' THEN
      v_desc := 'Disponibilità ' || COALESCE(v_row ->> 'stato','libero') ||
                ' per il ' || COALESCE(v_row ->> 'data','?');
    ELSIF p_action = 'delete' THEN
      v_desc := 'Disponibilità rimossa per il ' || COALESCE(v_row ->> 'data','?');
    ELSE
      v_desc := 'Disponibilità aggiornata per il ' || COALESCE(v_row ->> 'data','?') ||
                CASE WHEN p_diff ? 'stato'
                     THEN ' (stato: ' || (p_diff #>> '{stato,before}') || ' → ' || (p_diff #>> '{stato,after}') || ')'
                     ELSE '' END;
    END IF;

  ELSIF p_entity = 'cliente_stagionale' THEN
    IF p_action = 'insert' THEN
      v_desc := 'Cliente stagionale aggiunto: ' || COALESCE(v_row ->> 'nome','') || ' ' ||
                COALESCE(v_row ->> 'cognome','') || ' <' || COALESCE(v_row ->> 'email','') || '>';
    ELSIF p_action = 'delete' THEN
      v_desc := 'Cliente stagionale eliminato: ' || COALESCE(v_row ->> 'email','?');
    ELSE
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Cliente ' || COALESCE(v_row ->> 'email','?') || ' modificato (' || COALESCE(v_keys,'–') || ')';
    END IF;

  ELSIF p_entity = 'ombrellone' THEN
    IF p_action = 'insert' THEN
      v_desc := 'Ombrellone aggiunto: Fila ' || COALESCE(v_row ->> 'fila','?') ||
                ' N°' || COALESCE(v_row ->> 'numero','?') ||
                ' · credito/gg ' || COALESCE(v_row ->> 'credito_giornaliero','?');
    ELSIF p_action = 'delete' THEN
      v_desc := 'Ombrellone eliminato: Fila ' || COALESCE(v_row ->> 'fila','?') ||
                ' N°' || COALESCE(v_row ->> 'numero','?');
    ELSE
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Ombrellone Fila ' || COALESCE(v_row ->> 'fila','?') ||
                ' N°' || COALESCE(v_row ->> 'numero','?') || ' modificato (' || COALESCE(v_keys,'–') || ')';
    END IF;

  ELSIF p_entity = 'stabilimento' THEN
    IF p_action = 'update' THEN
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Stabilimento aggiornato (' || COALESCE(v_keys,'–') || ')';
    ELSIF p_action = 'insert' THEN
      v_desc := 'Stabilimento creato';
    ELSE
      v_desc := 'Stabilimento eliminato';
    END IF;

  ELSIF p_entity = 'profile' THEN
    IF p_action = 'update' THEN
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Profilo utente aggiornato (' || COALESCE(v_keys,'–') || ')';
    ELSIF p_action = 'insert' THEN
      v_desc := 'Profilo utente creato';
    ELSE
      v_desc := 'Profilo utente eliminato';
    END IF;

  ELSIF p_entity = 'regola_stato' THEN
    v_tipo_label := CASE COALESCE(v_row ->> 'tipo','')
      WHEN 'chiusura_speciale' THEN 'Chiusura speciale'
      WHEN 'sempre_libero'     THEN 'Sempre subaffittabile'
      WHEN 'mai_libero'        THEN 'Mai subaffittabile'
      ELSE COALESCE(v_row ->> 'tipo','?')
    END;
    v_range := COALESCE(v_row ->> 'data_da','?') || ' → ' || COALESCE(v_row ->> 'data_a','?');
    IF p_action = 'insert' THEN
      v_desc := 'Regola stato impostata: ' || v_tipo_label || ' (' || v_range || ')';
    ELSIF p_action = 'delete' THEN
      v_desc := 'Regola stato rimossa: ' || v_tipo_label || ' (' || v_range || ')';
    ELSE
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Regola stato aggiornata: ' || v_tipo_label || ' (' || COALESCE(v_keys,'–') || ')';
    END IF;
  END IF;

  RETURN v_desc;
END;
$function$;

DROP TRIGGER IF EXISTS audit_regole_stato ON public.regole_stato_ombrelloni;
CREATE TRIGGER audit_regole_stato
  AFTER INSERT OR UPDATE OR DELETE ON public.regole_stato_ombrelloni
  FOR EACH ROW EXECUTE FUNCTION public._audit_row_trigger('regola_stato');

-- ============================================================
-- RPC: crea_regola_stato
--
-- Crea una nuova regola e:
--   • per chiusura_speciale: annulla automaticamente i sub-affitti
--     esistenti nel range chiamando public.cancel_booking
--     (rimborso credito + ledger gestiti lì);
--   • emette UNA transazione `regola_forzata_aggiunta` per ogni cliente
--     stagionale dello stabilimento con un ombrellone assegnato
--     (granularità aggregata: una riga per cliente, non per giorno).
-- ============================================================

CREATE OR REPLACE FUNCTION public.crea_regola_stato(
  p_stabilimento_id uuid,
  p_tipo            text,
  p_data_da         date,
  p_data_a          date,
  p_nota            text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid       uuid := (SELECT auth.uid());
  v_id        uuid;
  v_disp_ids  uuid[];
  v_label     text;
  v_range_fmt text;
  v_cs        record;
  v_nota_clean text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stabilimenti
    WHERE id = p_stabilimento_id AND proprietario_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  IF p_tipo NOT IN ('chiusura_speciale','sempre_libero','mai_libero') THEN
    RAISE EXCEPTION 'Tipo regola non valido: %', p_tipo;
  END IF;

  IF p_data_a < p_data_da THEN
    RAISE EXCEPTION 'Data fine precedente alla data inizio';
  END IF;

  INSERT INTO public.regole_stato_ombrelloni
    (stabilimento_id, tipo, data_da, data_a, nota, created_by)
  VALUES
    (p_stabilimento_id, p_tipo, p_data_da, p_data_a, p_nota, v_uid)
  RETURNING id INTO v_id;

  -- chiusura_speciale: annulla i sub-affitti esistenti nel range.
  IF p_tipo = 'chiusura_speciale' THEN
    SELECT ARRAY(
      SELECT d.id
      FROM public.disponibilita d
      JOIN public.ombrelloni o ON o.id = d.ombrellone_id
      WHERE o.stabilimento_id = p_stabilimento_id
        AND d.data BETWEEN p_data_da AND p_data_a
        AND d.stato = 'sub_affittato'
    ) INTO v_disp_ids;

    IF array_length(v_disp_ids, 1) IS NOT NULL THEN
      PERFORM public.cancel_booking(v_disp_ids);
    END IF;
  END IF;

  -- Notifica aggregata ai clienti stagionali.
  v_label := CASE p_tipo
    WHEN 'chiusura_speciale' THEN 'Chiusura speciale'
    WHEN 'sempre_libero'     THEN 'Sempre subaffittabile'
    WHEN 'mai_libero'        THEN 'Mai subaffittabile'
  END;

  IF p_data_da = p_data_a THEN
    v_range_fmt := to_char(p_data_da, 'DD/MM/YYYY');
  ELSE
    v_range_fmt := 'dal ' || to_char(p_data_da, 'DD/MM/YYYY')
                || ' al '  || to_char(p_data_a,  'DD/MM/YYYY');
  END IF;

  v_nota_clean := NULLIF(btrim(COALESCE(p_nota,'')), '');

  FOR v_cs IN
    SELECT id, ombrellone_id
    FROM public.clienti_stagionali
    WHERE stabilimento_id = p_stabilimento_id
      AND ombrellone_id IS NOT NULL
  LOOP
    INSERT INTO public.transazioni
      (stabilimento_id, ombrellone_id, cliente_id, tipo, importo, nota)
    VALUES (
      p_stabilimento_id,
      v_cs.ombrellone_id,
      v_cs.id,
      'regola_forzata_aggiunta',
      0,
      v_label || ' impostata dal proprietario · ' || v_range_fmt
        || COALESCE(' — ' || v_nota_clean, '')
    );
  END LOOP;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crea_regola_stato(uuid, text, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crea_regola_stato(uuid, text, date, date, text) TO authenticated;

-- ============================================================
-- RPC: elimina_regola_stato
--
-- Elimina una regola e notifica i clienti stagionali con una
-- transazione `regola_forzata_rimossa` aggregata.
-- Nota: l'eliminazione di chiusura_speciale NON ripristina i
-- sub-affitti annullati — quelle prenotazioni sono già state
-- compensate nel ledger.
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

  DELETE FROM public.regole_stato_ombrelloni WHERE id = p_regola_id;

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

COMMENT ON TABLE public.regole_stato_ombrelloni IS
  'Override di stato per range di date di uno stabilimento (chiusura_speciale / sempre_libero / mai_libero). La chiusura stagionale è derivata da stabilimenti.data_*_stagione e NON sta in questa tabella.';
