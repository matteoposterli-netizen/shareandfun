-- Baseline schema dump of the public schema as of 2026-04-23.
-- Reconstructed via pg_catalog queries (see CLAUDE.md).
-- Replaces all prior migration files; captures current prod state.

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  cognome    text NOT NULL,
  telefono   text,
  ruolo      text NOT NULL,
  created_at timestamp DEFAULT now(),
  CONSTRAINT profiles_ruolo_check CHECK (ruolo = ANY (ARRAY['proprietario'::text, 'stagionale'::text]))
);

CREATE TABLE IF NOT EXISTS public.stabilimenti (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proprietario_id            uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome                       text NOT NULL,
  indirizzo                  text,
  citta                      text,
  telefono                   text,
  created_at                 timestamp DEFAULT now(),
  email                      text,
  email_benvenuto_oggetto    text DEFAULT 'Benvenuto su ShareAndFun!'::text,
  email_benvenuto_testo      text DEFAULT 'Siamo felici di averti con noi! Il tuo accesso è attivo.'::text,
  email_attesa_oggetto       text DEFAULT 'Richiesta di iscrizione ricevuta'::text,
  email_attesa_testo         text DEFAULT 'La tua richiesta è stata ricevuta. Il proprietario la esaminerà a breve.'::text,
  email_approvazione_oggetto text DEFAULT 'Iscrizione approvata!'::text,
  email_approvazione_testo   text DEFAULT 'Ottima notizia! La tua iscrizione è stata approvata. Puoi ora accedere alla piattaforma.'::text,
  email_invito_oggetto       text,
  email_invito_testo         text,
  email_credito_accreditato_oggetto text,
  email_credito_accreditato_testo   text,
  email_credito_ritirato_oggetto    text,
  email_credito_ritirato_testo      text
);

CREATE TABLE IF NOT EXISTS public.ombrelloni (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stabilimento_id     uuid REFERENCES public.stabilimenti(id) ON DELETE CASCADE,
  numero              integer NOT NULL,
  fila                text NOT NULL,
  credito_giornaliero numeric(6,2) DEFAULT 10.00,
  created_at          timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clienti_stagionali (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stabilimento_id uuid REFERENCES public.stabilimenti(id) ON DELETE CASCADE,
  ombrellone_id   uuid REFERENCES public.ombrelloni(id)   ON DELETE SET NULL,
  user_id         uuid REFERENCES public.profiles(id)     ON DELETE SET NULL,
  nome            text NOT NULL,
  cognome         text NOT NULL,
  email           text NOT NULL,
  telefono        text,
  credito_saldo   numeric(8,2) DEFAULT 0.00,
  created_at      timestamp DEFAULT now(),
  approvato       boolean NOT NULL DEFAULT false,
  rifiutato       boolean NOT NULL DEFAULT false,
  fonte           text    NOT NULL DEFAULT 'csv'::text,
  invito_token    uuid    DEFAULT gen_random_uuid() UNIQUE,
  invitato_at     timestamptz,
  note_match      text,
  CONSTRAINT clienti_stagionali_fonte_check CHECK (fonte = ANY (ARRAY['csv'::text, 'diretta'::text]))
);

CREATE TABLE IF NOT EXISTS public.disponibilita (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ombrellone_id uuid REFERENCES public.ombrelloni(id)         ON DELETE CASCADE,
  cliente_id    uuid REFERENCES public.clienti_stagionali(id) ON DELETE CASCADE,
  data          date NOT NULL,
  stato         text DEFAULT 'libero'::text,
  created_at    timestamp DEFAULT now(),
  CONSTRAINT disponibilita_stato_check CHECK (stato = ANY (ARRAY['libero'::text, 'sub_affittato'::text])),
  CONSTRAINT disponibilita_ombrellone_id_data_key UNIQUE (ombrellone_id, data)
);

CREATE TABLE IF NOT EXISTS public.transazioni (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stabilimento_id uuid REFERENCES public.stabilimenti(id)       ON DELETE CASCADE,
  ombrellone_id   uuid REFERENCES public.ombrelloni(id)         ON DELETE SET NULL,
  cliente_id      uuid REFERENCES public.clienti_stagionali(id) ON DELETE SET NULL,
  tipo            text NOT NULL,
  importo         numeric(8,2) DEFAULT 0.00,
  nota            text,
  created_at      timestamp DEFAULT now(),
  CONSTRAINT transazioni_tipo_check CHECK (tipo = ANY (ARRAY['disponibilita_aggiunta'::text, 'disponibilita_rimossa'::text, 'sub_affitto'::text, 'credito_ricevuto'::text, 'credito_usato'::text]))
);

-- ============================================================
-- Indexes (performance / FK coverage)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_clienti_stagionali_ombrellone_id   ON public.clienti_stagionali (ombrellone_id);
CREATE INDEX IF NOT EXISTS idx_clienti_stagionali_stabilimento_id ON public.clienti_stagionali (stabilimento_id);
CREATE INDEX IF NOT EXISTS idx_clienti_stagionali_user_id         ON public.clienti_stagionali (user_id);
CREATE INDEX IF NOT EXISTS idx_disponibilita_cliente_id           ON public.disponibilita (cliente_id);
CREATE INDEX IF NOT EXISTS idx_ombrelloni_stabilimento_id         ON public.ombrelloni (stabilimento_id);
CREATE INDEX IF NOT EXISTS idx_stabilimenti_proprietario_id       ON public.stabilimenti (proprietario_id);
CREATE INDEX IF NOT EXISTS idx_transazioni_cliente_id             ON public.transazioni (cliente_id);
CREATE INDEX IF NOT EXISTS idx_transazioni_ombrellone_id          ON public.transazioni (ombrellone_id);
CREATE INDEX IF NOT EXISTS idx_transazioni_stabilimento_id        ON public.transazioni (stabilimento_id);

-- ============================================================
-- RLS + Policies (consolidated: one policy per table/command)
-- ============================================================

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stabilimenti       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ombrelloni         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clienti_stagionali ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disponibilita      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transazioni        ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (id = (SELECT auth.uid()));
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- stabilimenti
CREATE POLICY stabilimenti_select ON public.stabilimenti
  FOR SELECT USING (true);
CREATE POLICY stabilimenti_insert ON public.stabilimenti
  FOR INSERT WITH CHECK (proprietario_id = (SELECT auth.uid()));
CREATE POLICY stabilimenti_update ON public.stabilimenti
  FOR UPDATE USING (proprietario_id = (SELECT auth.uid()))
  WITH CHECK (proprietario_id = (SELECT auth.uid()));
CREATE POLICY stabilimenti_delete ON public.stabilimenti
  FOR DELETE USING (proprietario_id = (SELECT auth.uid()));

-- ombrelloni
CREATE POLICY ombrelloni_select ON public.ombrelloni
  FOR SELECT USING (true);
CREATE POLICY ombrelloni_insert ON public.ombrelloni
  FOR INSERT WITH CHECK (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );
CREATE POLICY ombrelloni_update ON public.ombrelloni
  FOR UPDATE USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );
CREATE POLICY ombrelloni_delete ON public.ombrelloni
  FOR DELETE USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );

-- clienti_stagionali
CREATE POLICY clienti_stagionali_select ON public.clienti_stagionali
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );
CREATE POLICY clienti_stagionali_insert ON public.clienti_stagionali
  FOR INSERT WITH CHECK (
    user_id = (SELECT auth.uid())
    OR stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );
CREATE POLICY clienti_stagionali_update ON public.clienti_stagionali
  FOR UPDATE USING (
    user_id = (SELECT auth.uid())
    OR stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );
CREATE POLICY clienti_stagionali_delete ON public.clienti_stagionali
  FOR DELETE USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );

-- disponibilita
CREATE POLICY disponibilita_select ON public.disponibilita
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.ombrelloni o
      JOIN public.stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id AND s.proprietario_id = (SELECT auth.uid())
    )
    OR cliente_id IN (SELECT id FROM public.clienti_stagionali WHERE user_id = (SELECT auth.uid()))
  );
CREATE POLICY disponibilita_insert ON public.disponibilita
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ombrelloni o
      JOIN public.stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id AND s.proprietario_id = (SELECT auth.uid())
    )
    OR cliente_id IN (SELECT id FROM public.clienti_stagionali WHERE user_id = (SELECT auth.uid()))
  );
CREATE POLICY disponibilita_update ON public.disponibilita
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.ombrelloni o
      JOIN public.stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id AND s.proprietario_id = (SELECT auth.uid())
    )
    OR cliente_id IN (SELECT id FROM public.clienti_stagionali WHERE user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ombrelloni o
      JOIN public.stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id AND s.proprietario_id = (SELECT auth.uid())
    )
    OR cliente_id IN (SELECT id FROM public.clienti_stagionali WHERE user_id = (SELECT auth.uid()))
  );
CREATE POLICY disponibilita_delete ON public.disponibilita
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.ombrelloni o
      JOIN public.stabilimenti s ON s.id = o.stabilimento_id
      WHERE o.id = disponibilita.ombrellone_id AND s.proprietario_id = (SELECT auth.uid())
    )
    OR cliente_id IN (SELECT id FROM public.clienti_stagionali WHERE user_id = (SELECT auth.uid()))
  );

-- transazioni
CREATE POLICY transazioni_select ON public.transazioni
  FOR SELECT USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
    OR cliente_id IN (SELECT id FROM public.clienti_stagionali WHERE user_id = (SELECT auth.uid()))
  );
CREATE POLICY transazioni_insert ON public.transazioni
  FOR INSERT WITH CHECK (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );
CREATE POLICY transazioni_update ON public.transazioni
  FOR UPDATE USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );
CREATE POLICY transazioni_delete ON public.transazioni
  FOR DELETE USING (
    stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE proprietario_id = (SELECT auth.uid()))
  );

-- ============================================================
-- RPC functions (SECURITY DEFINER)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_cliente_by_invito_token(p_token uuid)
RETURNS TABLE(
  id uuid, nome text, cognome text, email text, telefono text,
  stabilimento_id uuid, stabilimento_nome text,
  ombrellone_id uuid, ombrellone_fila text, ombrellone_numero integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    cs.id, cs.nome, cs.cognome, cs.email, cs.telefono,
    cs.stabilimento_id,
    s.nome  AS stabilimento_nome,
    cs.ombrellone_id,
    o.fila  AS ombrellone_fila,
    o.numero AS ombrellone_numero
  FROM clienti_stagionali cs
  LEFT JOIN stabilimenti s ON s.id = cs.stabilimento_id
  LEFT JOIN ombrelloni   o ON o.id = cs.ombrellone_id
  WHERE cs.invito_token = p_token
    AND cs.user_id IS NULL
    AND cs.rifiutato = false
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.completa_registrazione_invito(p_token uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rows_updated integer;
BEGIN
  UPDATE clienti_stagionali
  SET user_id   = p_user_id,
      approvato = true,
      fonte     = 'csv'
  WHERE invito_token = p_token
    AND user_id IS NULL;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$function$;
