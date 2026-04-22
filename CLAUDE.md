# ShareAndFun

Piattaforma in italiano per **sub-affitto di ombrelloni balneari stagionali**.
Proprietari di stabilimento gestiscono clienti stagionali; i clienti possono rendere disponibili i propri ombrelloni per il sub-affitto giornaliero.

## Stack

- **Frontend**: SPA single-file (`index.html` ~2000 righe), HTML+CSS+JS inline, nessun build step. CDN `@supabase/supabase-js@2`. Font DM Sans / DM Serif Display.
- **Backend**: Supabase (Postgres 17 + Auth + Edge Functions).
- **Email transazionali**: Resend via Edge Function `invia-email`.
- **Deploy**: Vercel. Production su `main`; ogni push su branch diverso genera un **Preview Deployment** automatico.

## Supabase

- **Project ID**: `btnyzzpibedkslhtiizu`
- **Region**: eu-west-1
- **Dashboard**: https://supabase.com/dashboard/project/btnyzzpibedkslhtiizu
- **Ambiente unico** (non c'è staging separato) → qualsiasi modifica al DB via MCP è **immediatamente live in produzione**. Chiedi sempre conferma esplicita prima di applicare migrazioni, deploy di Edge Functions, o SQL distruttivo.

### Schema (public)

| Tabella | Scopo |
|---|---|
| `profiles` | Utenti (ruolo: `proprietario` o `stagionale`), FK ad `auth.users` |
| `stabilimenti` | Stabilimento balneare, owned da un proprietario. Contiene anche i template email personalizzabili (`email_benvenuto_*`, `email_attesa_*`, `email_approvazione_*`) |
| `ombrelloni` | Ombrelloni di uno stabilimento (fila, numero, credito giornaliero) |
| `clienti_stagionali` | Clienti stagionali con `approvato`/`rifiutato`/`fonte` (`csv`\|`diretta`) e `invito_token` per registrazione via link |
| `disponibilita` | Giornate in cui un ombrellone è messo a disposizione o sub-affittato |
| `transazioni` | Storico contabile (credito aggiunto/usato, sub-affitti) |

RLS attiva ovunque. Policy consolidate (una per tabella/comando) con `(select auth.uid())` per performance. Vedi `supabase/migrations/20260422_security_performance_hardening.sql`.

### RPC functions (SECURITY DEFINER)

- `get_cliente_by_invito_token(p_token uuid)` — dati cliente pre-compilati per link invito
- `completa_registrazione_invito(p_token uuid, p_user_id uuid)` — finalizza signup da invito

### Edge Functions

- `invia-email` — invia email transazionali via Resend. Tipi: `benvenuto`, `attesa`, `approvazione`, `invito`. JWT verify ON. Env richieste: `RESEND_API_KEY`, `FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Workflow Git

- **Production branch**: `main` → deploy Vercel produzione
- **Feature/review branch corrente**: `claude/review-shareandfun-project-XWt63`
  Tutti i lavori di review/fix vanno qui. Vercel crea un preview URL per questo branch.
- **Mai pushare direttamente su `main`** senza conferma esplicita dell'utente. Merge su main = deploy produzione.

## Convenzioni

- Tutto il testo user-facing è in **italiano**.
- Palette "mare" (definita come CSS vars in `index.html`): `--ocean` `#1B6CA8`, `--sand` `#F5F0E8`, `--coral` `#E07B54`.
- Commit messages in inglese, concisi, focus sul "why".

## Note operative

- Prima di toccare il DB (migrazioni, SQL, edge function) chiedere sempre conferma.
- Il file `index.html` è una SPA monolitica: modifiche vanno fatte in-place con Edit, non riscrivere da zero.
- Advisors Supabase da monitorare dopo modifiche RLS: `mcp__*__get_advisors` per `security` e `performance`.
- Unico warning di sicurezza noto e non risolvibile via SQL: `Leaked Password Protection` — va attivato manualmente dal dashboard Auth.
