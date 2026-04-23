# SpiaggiaMia

Piattaforma in italiano per **sub-affitto di ombrelloni balneari stagionali**. Dominio: `spiaggiamia.com`.
Proprietari di stabilimento gestiscono clienti stagionali; i clienti possono rendere disponibili i propri ombrelloni per il sub-affitto giornaliero.

## Stack

- **Frontend**: SPA single-file (`index.html` ~2000 righe), HTML+CSS+JS inline, nessun build step. CDN `@supabase/supabase-js@2` + `SheetJS (xlsx)` per import/export Excel. Font DM Sans / DM Serif Display.
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
| `stabilimenti` | Stabilimento balneare, owned da un proprietario. Template email personalizzabili: `email_benvenuto_*` e `email_invito_oggetto`/`email_invito_testo` (fallback ai default se NULL). Le colonne `email_attesa_*`/`email_approvazione_*` esistono ancora nello schema ma non sono più esposte dalla UI (flow invite-only). |
| `ombrelloni` | Ombrelloni di uno stabilimento (fila, numero, credito giornaliero) |
| `clienti_stagionali` | Clienti stagionali con `approvato`/`rifiutato`/`fonte` e `invito_token` per registrazione via link. **Nessuna registrazione autonoma**: esistono solo record creati dal proprietario (invito singolo o CSV); `user_id` viene popolato quando il cliente completa l'invito. |
| `disponibilita` | Giornate in cui un ombrellone è messo a disposizione o sub-affittato |
| `transazioni` | Storico contabile (credito aggiunto/usato, sub-affitti) |

RLS attiva ovunque. Policy consolidate (una per tabella/comando) con `(select auth.uid())` per performance. L'intero schema `public` (tabelle, FK, indexes, RLS, policies, RPC) è catturato come baseline in `supabase/migrations/20260420000000_baseline.sql`; migrazioni future vanno come file addizionali con timestamp successivo.

### RPC functions (SECURITY DEFINER)

- `get_cliente_by_invito_token(p_token uuid)` — dati cliente pre-compilati per link invito
- `completa_registrazione_invito(p_token uuid, p_user_id uuid)` — finalizza signup da invito

### Edge Functions

- `invia-email` — invia email transazionali via Resend. Dominio mittente: `spiaggiamia.com` (verificato su Resend, DNS gestiti da Vercel). Tipi attivamente usati dalla UI: `benvenuto` (post-completamento invito) e `invito` (link personale). Entrambi accettano `oggetto_custom`/`testo_custom` (oggetto + paragrafo introduttivo, NL→`<br>` per `invito`); se omessi si usano i default. I tipi `attesa`/`approvazione` sono ancora supportati dalla function ma non più invocati dal frontend (registrazione è solo su invito). JWT verify ON. Env richieste: `RESEND_API_KEY`, `FROM_EMAIL` (default fallback `SpiaggiaMia <noreply@spiaggiamia.com>`), `SUPABASE_SERVICE_ROLE_KEY`. **Attenzione**: la `RESEND_API_KEY` deve avere accesso al dominio `spiaggiamia.com` (permission "Full access" oppure "Sending access" con `spiaggiamia.com` selezionato). Una key ristretta a un altro dominio produce 500 con `statusCode:400 "The associated domain...key with full access or with a verified domain"`.

## Flow registrazione clienti stagionali (invite-only)

Dalla riorganizzazione `claude/beach-invite-only-registration-wlsjM` gli stagionali **non possono più registrarsi autonomamente**. Percorsi supportati:

1. **Aggiunta singola**: proprietario apre modal "+ Aggiungi" nel tab "Ombrelloni e Clienti" → crea/aggiorna l'ombrellone e opzionalmente il cliente (+ invito email `invito` con link `/?invito=<token>`).
2. **Importazione massiva via Excel**: upload `.xlsx` nel tab "Ombrelloni e Clienti" → upsert ombrelloni + clienti + invio email invito in batch. Colonne supportate: `fila, numero, credito_giornaliero, nome, cognome, telefono, email` (cliente opzionale).
3. Il cliente clicca il link → `showInvitoView` pre-compila dati → `completa_registrazione_invito` approva automaticamente (`approvato=true`) → email `benvenuto`.

Non esiste più il ramo "registrazione diretta" (`fonte='diretta'`) né il concetto di "richieste in attesa di approvazione".

## Workflow Git

- **Production branch**: `main` → deploy Vercel produzione
- **Feature/review branch corrente**: `claude/consolidate-management-tabs-qwYCz`
  Tutti i lavori vanno qui. Vercel crea un preview URL per questo branch.
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

## Mantenimento di questo file

Quando una sessione introduce un cambiamento **strutturale** — nuova tabella, nuova colonna/FK rilevante, nuova RPC, nuova Edge Function, nuovo env var, nuova convenzione, cambio di workflow git — **aggiorna `CLAUDE.md` nella stessa sessione** (preferibilmente nello stesso commit del cambiamento).

Un hook `Stop` in `.claude/settings.json` (→ `.claude/claude-md-reminder.sh`) controlla l'ultimo commit e il working tree: se `supabase/migrations/` o `supabase/functions/` cambiano senza che `CLAUDE.md` sia toccato, emette un reminder al termine del turno.
