-- RPC: conferma_prenotazione_stagionale
-- Atomicamente:
--   - aggiorna disponibilita a sub_affittato per le date passate
--   - aggiunge transazioni di credito per ogni data
--   - aggiorna credito_saldo del cliente
-- SECURITY DEFINER: bypassa RLS, ma valida che p_cliente_id appartenga all'utente loggato.

CREATE OR REPLACE FUNCTION public.conferma_prenotazione_stagionale(
  p_cliente_id    uuid,
  p_ombrellone_id uuid,
  p_date          date[],
  p_credito_per_giorno numeric,
  p_nome_prenotazione text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stabilimento_id uuid;
  v_credito_totale  numeric;
  v_data            date;
  v_disp_id         uuid;
  v_sub_affitti     int := 0;
BEGIN
  -- Validazione: il cliente deve appartenere all'utente loggato
  SELECT stabilimento_id INTO v_stabilimento_id
  FROM clienti_stagionali
  WHERE id = p_cliente_id
    AND user_id = auth.uid();

  IF v_stabilimento_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cliente non autorizzato');
  END IF;

  v_credito_totale := p_credito_per_giorno * array_length(p_date, 1);

  -- Per ogni data: aggiorna disponibilita e inserisci transazione
  FOREACH v_data IN ARRAY p_date LOOP
    -- Aggiorna stato disponibilita
    UPDATE disponibilita
    SET stato = 'sub_affittato'
    WHERE ombrellone_id = p_ombrellone_id
      AND cliente_id    = p_cliente_id
      AND data          = v_data
      AND stato         = 'libero';

    IF FOUND THEN
      v_sub_affitti := v_sub_affitti + 1;

      -- Inserisci transazione credito per questa data
      INSERT INTO transazioni (stabilimento_id, ombrellone_id, cliente_id, tipo, importo, nota)
      VALUES (
        v_stabilimento_id,
        p_ombrellone_id,
        p_cliente_id,
        'credito_ricevuto',
        p_credito_per_giorno,
        COALESCE(p_nome_prenotazione, 'Sub-affitto ' || v_data::text)
      );
    END IF;
  END LOOP;

  -- Aggiorna saldo credito cliente
  IF v_sub_affitti > 0 THEN
    UPDATE clienti_stagionali
    SET credito_saldo = credito_saldo + (p_credito_per_giorno * v_sub_affitti)
    WHERE id = p_cliente_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sub_affitti', v_sub_affitti,
    'credito_totale', p_credito_per_giorno * v_sub_affitti
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.conferma_prenotazione_stagionale(uuid, uuid, date[], numeric, text)
  TO authenticated;
