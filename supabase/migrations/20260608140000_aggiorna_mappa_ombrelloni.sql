-- RPC atomica per salvare la mappa ombrelloni di uno stabilimento.
-- Risolve il bug per cui UPDATE sequenziali falliscono silenziosamente
-- quando il nuovo (pos_x, pos_y) o codice collide con la riga di un altro
-- ombrellone non ancora aggiornato (vincolo unique non deferrable).
--
-- Strategia two-phase:
--  1) parcheggio tutti gli ombrelloni da aggiornare in (-1, -rank) + codice
--     temporaneo univoco (`__tmp_<uuid>`) → libera tutte le celle target;
--  2) scrittura pos_x/pos_y/codice finali → nessun conflitto possibile;
--  3) INSERT dei nuovi su celle che a quel punto sono libere.
--
-- L'audit della fase 1 (parking) è soppresso tramite la GUC `audit.batch_tag`
-- letta dal trigger `_audit_row_trigger`. La fase 2 logga normalmente la UPDATE
-- (before = pos di parcheggio, after = pos finale: accettabile).

CREATE OR REPLACE FUNCTION public.aggiorna_mappa_ombrelloni(
  p_stabilimento_id uuid,
  p_deletes         uuid[]  DEFAULT '{}',
  p_updates         jsonb   DEFAULT '[]'::jsonb,
  p_inserts         jsonb   DEFAULT '[]'::jsonb,
  p_passerelle      jsonb   DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _owner       uuid;
  _deleted_n   int := 0;
  _updated_n   int := 0;
  _inserted_n  int := 0;
BEGIN
  -- ownership
  SELECT proprietario_id
    INTO _owner
    FROM public.stabilimenti
   WHERE id = p_stabilimento_id;

  IF _owner IS NULL THEN
    RAISE EXCEPTION 'Stabilimento non trovato' USING ERRCODE = 'P0002';
  END IF;
  -- IS DISTINCT FROM (non `<>`): con un chiamante anon auth.uid() è NULL e
  -- `_owner <> NULL` darebbe NULL (falsy), bypassando il check. IS DISTINCT FROM
  -- tratta il NULL come "diverso" e fa scattare l'eccezione.
  IF _owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Permesso negato' USING ERRCODE = '42501';
  END IF;

  -- 1) DELETE
  IF array_length(p_deletes, 1) IS NOT NULL THEN
    DELETE FROM public.clienti_stagionali
     WHERE ombrellone_id = ANY(p_deletes);
    -- disponibilita cascade automaticamente via FK ON DELETE CASCADE
    DELETE FROM public.ombrelloni
     WHERE id = ANY(p_deletes)
       AND stabilimento_id = p_stabilimento_id;
    GET DIAGNOSTICS _deleted_n = ROW_COUNT;
  END IF;

  -- 2) UPDATE two-phase
  IF jsonb_array_length(p_updates) > 0 THEN
    -- Fase 1: parcheggio + codice temp. Audit soppresso.
    PERFORM set_config('audit.batch_tag',
                       'mappa_park_' || p_stabilimento_id::text,
                       true);

    WITH ranked AS (
      SELECT (rec->>'id')::uuid AS id,
             row_number() OVER () AS rn
      FROM jsonb_array_elements(p_updates) WITH ORDINALITY AS t(rec, ord)
    )
    UPDATE public.ombrelloni o
       SET pos_x  = -1,
           pos_y  = -(r.rn::int),
           codice = '__tmp_' || o.id::text
      FROM ranked r
     WHERE o.id = r.id
       AND o.stabilimento_id = p_stabilimento_id;

    -- Riabilita audit per la fase 2
    PERFORM set_config('audit.batch_tag', '', true);

    -- Fase 2: pos + codice finali
    UPDATE public.ombrelloni o
       SET pos_x  = (rec->>'pos_x')::int,
           pos_y  = (rec->>'pos_y')::int,
           codice = rec->>'codice'
      FROM jsonb_array_elements(p_updates) AS rec
     WHERE o.id = (rec->>'id')::uuid
       AND o.stabilimento_id = p_stabilimento_id;
    GET DIAGNOSTICS _updated_n = ROW_COUNT;
  END IF;

  -- 3) INSERT nuovi
  IF jsonb_array_length(p_inserts) > 0 THEN
    INSERT INTO public.ombrelloni
      (stabilimento_id, codice, pos_x, pos_y, credito_giornaliero)
    SELECT p_stabilimento_id,
           rec->>'codice',
           (rec->>'pos_x')::int,
           (rec->>'pos_y')::int,
           COALESCE((rec->>'credito_giornaliero')::numeric, 1.00)
      FROM jsonb_array_elements(p_inserts) AS rec;
    GET DIAGNOSTICS _inserted_n = ROW_COUNT;
  END IF;

  -- 4) Passerelle
  UPDATE public.stabilimenti
     SET mappa_passerelle = p_passerelle
   WHERE id = p_stabilimento_id;

  RETURN jsonb_build_object(
    'ok',       true,
    'deleted',  _deleted_n,
    'updated',  _updated_n,
    'inserted', _inserted_n
  );
END;
$fn$;

-- Revoca anche da `anon`: Supabase concede EXECUTE di default a anon su ogni
-- nuova funzione in public, e il solo REVOKE FROM PUBLIC non lo rimuove.
REVOKE ALL ON FUNCTION public.aggiorna_mappa_ombrelloni(uuid, uuid[], jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aggiorna_mappa_ombrelloni(uuid, uuid[], jsonb, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.aggiorna_mappa_ombrelloni(uuid, uuid[], jsonb, jsonb, jsonb) IS
  'Salva la mappa ombrelloni di uno stabilimento in modo atomico, con strategia two-phase per evitare violazioni del vincolo unique (stabilimento_id, pos_x, pos_y) e (stabilimento_id, codice) durante UPDATE bulk. Chiamata solo dal proprietario dello stabilimento.';
