-- 1. Aggiungi le nuove colonne a ombrelloni
ALTER TABLE public.ombrelloni
  ADD COLUMN IF NOT EXISTS codice text,
  ADD COLUMN IF NOT EXISTS pos_x  integer,
  ADD COLUMN IF NOT EXISTS pos_y  integer;

-- 2. Popola codice dai dati esistenti (migrazione dati legacy)
UPDATE public.ombrelloni
SET codice = fila || numero::text
WHERE codice IS NULL;

-- 3. Rendi codice NOT NULL e aggiungi vincoli
ALTER TABLE public.ombrelloni
  ALTER COLUMN codice SET NOT NULL,
  ALTER COLUMN pos_x SET DEFAULT 0,
  ALTER COLUMN pos_y SET DEFAULT 0;

UPDATE public.ombrelloni SET pos_x = 0, pos_y = 0
WHERE pos_x IS NULL;

ALTER TABLE public.ombrelloni
  ALTER COLUMN pos_x SET NOT NULL,
  ALTER COLUMN pos_y SET NOT NULL;

-- 4. UNIQUE codice per stabilimento
ALTER TABLE public.ombrelloni
  DROP CONSTRAINT IF EXISTS ombrelloni_stabilimento_id_codice_key;
ALTER TABLE public.ombrelloni
  ADD CONSTRAINT ombrelloni_stabilimento_id_codice_key
  UNIQUE (stabilimento_id, codice);

-- 5. UNIQUE posizione per stabilimento
ALTER TABLE public.ombrelloni
  DROP CONSTRAINT IF EXISTS ombrelloni_stabilimento_id_pos_key;
ALTER TABLE public.ombrelloni
  ADD CONSTRAINT ombrelloni_stabilimento_id_pos_key
  UNIQUE (stabilimento_id, pos_x, pos_y);

-- 6. Aggiungi mappa_passerelle a stabilimenti
ALTER TABLE public.stabilimenti
  ADD COLUMN IF NOT EXISTS mappa_passerelle jsonb DEFAULT '[]'::jsonb;

-- 7. Aggiorna la funzione audit che usa fila/numero
CREATE OR REPLACE FUNCTION public.build_audit_desc(
  p_entity text,
  p_action text,
  p_row    jsonb,
  p_diff   jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_desc text;
  v_keys text;
  v_tipo_label text;
  v_range text;
BEGIN
  IF p_entity = 'ombrellone' THEN
    IF p_action = 'insert' THEN
      v_desc := 'Ombrellone aggiunto: ' || COALESCE(p_row ->> 'codice', '?') ||
                ' · credito/gg ' || COALESCE(p_row ->> 'credito_giornaliero', '?');
    ELSIF p_action = 'delete' THEN
      v_desc := 'Ombrellone eliminato: ' || COALESCE(p_row ->> 'codice', '?');
    ELSE
      SELECT string_agg(k, ', ' ORDER BY k) INTO v_keys
        FROM jsonb_object_keys(p_diff) k;
      v_desc := 'Ombrellone ' || COALESCE(p_row ->> 'codice', '?') ||
                ' modificato (' || COALESCE(v_keys, '–') || ')';
    END IF;
  END IF;
  RETURN v_desc;
END;
$$;

-- 8. Rimuovi le vecchie colonne fila e numero
ALTER TABLE public.ombrelloni
  DROP COLUMN IF EXISTS fila,
  DROP COLUMN IF EXISTS numero;
