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
| `stabilimenti` | Stabilimento balneare, owned da un proprietario. Template email personalizzabili: `email_benvenuto_*`, `email_invito_*`, `email_credito_accreditato_*`, `email_credito_ritirato_*` (fallback ai default in `js/email.js` se NULL). Le colonne `email_attesa_*`/`email_approvazione_*` esistono ancora nello schema ma non sono più esposte dalla UI (flow invite-only). |
| `ombrelloni` | Ombrelloni di uno stabilimento (fila, numero, credito giornaliero) |
| `clienti_stagionali` | Clienti stagionali con `approvato`/`rifiutato`/`fonte` e `invito_token` per registrazione via link. **Nessuna registrazione autonoma**: esistono solo record creati dal proprietario (invito singolo o CSV); `user_id` viene popolato quando il cliente completa l'invito. |
| `disponibilita` | Giornate in cui un ombrellone è messo a disposizione o sub-affittato. Colonna opzionale `nome_prenotazione` (text, nullable) per raggruppare sub-affitti multi-giorno / multi-ombrellone sotto una stessa etichetta visibile al gestore nella tab "Prenotazioni". |
| `transazioni` | Storico contabile (credito aggiunto/usato, sub-affitti) |
| `admins` | Account amministratori di sistema. PK `user_id` → `auth.users(id)`. **Non hanno riga in `profiles`**: le credenziali sono distinte dai proprietari/stagionali. Provisioning manuale via dashboard Supabase (vedi sezione "Area Admin"). |
| `audit_log` | Log delle modifiche fatte sullo stabilimento (INSERT/UPDATE/DELETE su tutte le tabelle business + login proprietario + email inviate + import batch). Populato via trigger `_audit_row_trigger` (SECURITY DEFINER) e RPC `audit_log_write` / `audit_coalesce_import`. RLS: proprietario vede solo i propri eventi, admin vede tutto. Retention 30 giorni via job `pg_cron` "audit-log-retention" (03:00 daily). Vedi sezione "Audit log". |

RLS attiva ovunque. Policy consolidate (una per tabella/comando) con `(select auth.uid())` per performance. In aggiunta, ogni tabella business ha un set di policy `*_admin_*` che concedono accesso totale agli utenti presenti in `public.admins` (controllato via `public.is_admin(uid)` — SECURITY DEFINER). L'intero schema `public` (tabelle, FK, indexes, RLS, policies, RPC) è catturato come baseline in `supabase/migrations/20260420000000_baseline.sql`; migrazioni future vanno come file addizionali con timestamp successivo.

> Tutte le migrazioni in `supabase/migrations/` sono state applicate sul DB di produzione al 2026-04-24, **eccetto** `20260424500000_audit_log.sql` (audit log) che richiede anche l'attivazione di `pg_cron` — applicare manualmente via SQL Editor quando si vuole abilitare il log.
>
> Applicare nuove migrazioni via Supabase dashboard (SQL Editor), `supabase db push` o `psql`.
>
> **Estensioni Postgres attive**: `pg_cron` (schedula il job di retention dell'audit log — richiede grant specifico, tipicamente pre-attivato nel dashboard Supabase → Database → Extensions).

### RPC functions (SECURITY DEFINER)

- `get_cliente_by_invito_token(p_token uuid)` — dati cliente pre-compilati per link invito
- `completa_registrazione_invito(p_token uuid, p_user_id uuid)` — finalizza signup da invito
- `cancel_booking(p_disp_ids uuid[])` — annullamento atomico di una prenotazione: verifica che il caller sia proprietario dello stabilimento implicato dalle disponibilità passate, riporta le righe a `libero`, inserisce le transazioni `sub_affitto_annullato` (+ `credito_revocato` e scrittura `credito_saldo` se c'è un cliente stagionale assegnato). Bypassa RLS tramite SECURITY DEFINER perché il flusso client-side equivalente falliva con `new row violates row-level security policy for table "transazioni"` in produzione.
- `audit_log_write(p_stabilimento_id, p_entity_type, p_action, p_description, p_entity_id?, p_metadata?)` — inserisce riga in `audit_log` per eventi non-DML (login, email, import batch). Autorizza proprietario, admin o service_role.
- `audit_coalesce_import(p_stabilimento_id, p_since, p_summary, p_metadata?)` — sostituisce gli eventi per-riga generati dai trigger durante un import Excel (entity_type IN ombrellone/cliente_stagionale/transazione/disponibilita, `actor_id = current_user`, `created_at >= p_since`) con un unico evento `import_batch`.

### Edge Functions

- `invia-email` — invia email transazionali via Resend. Dominio mittente: `spiaggiamia.com` (verificato su Resend, DNS gestiti da Vercel). Tipi attivamente usati dalla UI:
  - `invito` (link personale via `invite_link`)
  - `benvenuto` (post-completamento invito; include CTA "Accedi a SpiaggiaMia" se viene passato `login_link`)
  - `credito_accreditato` (ad ogni inserimento di transazione `credito_ricevuto` — incluso il sub-affitto automatico)
  - `credito_ritirato` (ad ogni inserimento di transazione `credito_usato`)

  Tutti accettano `oggetto_custom`/`testo_custom` (NL→`<br>` per `invito`/`credito_*`); se omessi si usano i default. I tipi `credito_*` accettano anche `importo_formatted`, `saldo_formatted`, `nota`. Placeholders supportati nei template: `{{nome}}`, `{{cognome}}`, `{{ombrellone}}`, `{{importo}}`, `{{saldo}}`, `{{nota}}`, `{{stabilimento}}` (sostituiti lato client in `js/utils.js → substitutePlaceholders`). I tipi `attesa`/`approvazione` sono ancora supportati dalla function ma non più invocati dal frontend (registrazione è solo su invito). Dopo ogni invio riuscito, la function chiama `audit_log_write` (inoltrando il JWT del chiamante via header `Authorization`) per registrare un evento `email_sent` in `audit_log`; richiede `stabilimento_id` nel body della richiesta. JWT verify ON. Env richieste: `RESEND_API_KEY`, `FROM_EMAIL` (default fallback `SpiaggiaMia <noreply@spiaggiamia.com>`), `SUPABASE_SERVICE_ROLE_KEY`. **Attenzione**: la `RESEND_API_KEY` deve avere accesso al dominio `spiaggiamia.com` (permission "Full access" oppure "Sending access" con `spiaggiamia.com` selezionato). Una key ristretta a un altro dominio produce 500 con `statusCode:400 "The associated domain...key with full access or with a verified domain"`.

## Flow registrazione clienti stagionali (invite-only)

Dalla riorganizzazione `claude/beach-invite-only-registration-wlsjM` gli stagionali **non possono più registrarsi autonomamente**. Percorsi supportati:

1. **Aggiunta singola**: proprietario apre modal "+ Aggiungi" nel tab "Ombrelloni e Clienti" → crea/aggiorna l'ombrellone e opzionalmente il cliente (+ invito email `invito` con link `/?invito=<token>`).
2. **Importazione massiva via Excel**: upload `.xlsx` nel tab "Ombrelloni e Clienti" → upsert ombrelloni + clienti + invio email invito in batch. Colonne supportate: `fila, numero, credito_giornaliero, nome, cognome, telefono, email` (cliente opzionale).
3. Il cliente clicca il link → `showInvitoView` pre-compila dati → `completa_registrazione_invito` approva automaticamente (`approvato=true`) → email `benvenuto`.

Non esiste più il ramo "registrazione diretta" (`fonte='diretta'`) né il concetto di "richieste in attesa di approvazione".

## Area Admin

Accesso: `https://spiaggiamia.com/?admin=1`. UI dedicata (vedi `js/admin.js`, view `#view-admin-login` e `#view-admin` in `index.html`) con login separato dalle credenziali proprietario/stagionale. Dopo login verifica presenza di `auth.uid()` in `public.admins` e mostra una dashboard con sidebar + CRUD generico sulle 6 tabelle (`profiles`, `stabilimenti`, `ombrelloni`, `clienti_stagionali`, `disponibilita`, `transazioni`). Le modifiche passano attraverso RLS (policy `*_admin_*`) — niente service-role in frontend.

**Provisioning di un nuovo admin** (manuale, no UI di self-signup):
1. Dashboard Supabase → Authentication → Users → **Add user** (email + password).
2. SQL Editor: `INSERT INTO public.admins (user_id) VALUES ('<uuid-dell-utente>');`

**Schema admins**: `(user_id uuid PK → auth.users.id ON DELETE CASCADE, created_at timestamptz default now())`. Unica policy: `admins_self_select` (un admin può leggere solo la propria riga). Nessuna INSERT/UPDATE/DELETE policy → modifiche ad `admins` solo via service role.

## Audit log

Tab "Log attività" lato proprietario (`#mtab-log` in `index.html`, logica in `js/audit.js`). Mostra tutti gli eventi registrati in `public.audit_log` per lo stabilimento del proprietario, con filtri (range date, tipo attore, entità, azione, testo libero) e export Excel dei risultati filtrati.

**Copertura eventi**:
- DML su `transazioni`, `disponibilita`, `clienti_stagionali`, `ombrelloni`, `stabilimenti`, `profiles` → trigger `AFTER INSERT/UPDATE/DELETE` parametrizzato (`_audit_row_trigger`, SECURITY DEFINER). Calcola `before`/`after`/`diff` (solo campi cambiati). Risoluzione `stabilimento_id`: diretta per le tabelle con FK diretta, via `ombrelloni` per `disponibilita`, via `clienti_stagionali` per `profiles`. Stabilimento `DELETE` viene skippato (CASCADE eliminerebbe subito la riga di log).
- Login del proprietario (non degli stagionali) → `js/auth.js → doLogin` chiama RPC `audit_log_write` con `entity_type='auth'`, `action='login'`.
- Email inviate da `invia-email` → la Edge Function chiama `audit_log_write` dopo ogni send Resend riuscito; richiede `stabilimento_id` nel body.
- Import Excel → `js/clienti.js → importaExcel` registra `auditSince` a inizio import e chiama `audit_coalesce_import` a fine, che sostituisce le N righe per-riga con un unico evento `import_batch`.

**Attore**: uno di `proprietario`/`stagionale`/`admin`/`sistema` (nessun `auth.uid()` → `sistema`). Calcolato da `_audit_current_actor()` (SECURITY DEFINER): verifica `is_admin()`, poi legge `profiles.ruolo`, poi arricchisce la label con dati da `clienti_stagionali` per gli stagionali.

**Retention**: 30 giorni. Job `pg_cron` "audit-log-retention" (03:00 daily) esegue `DELETE FROM public.audit_log WHERE created_at < now() - interval '30 days'`. Estensione `pg_cron` attivata nella migrazione `20260424500000_audit_log.sql`.

**Suppressione batch futura**: il trigger controlla la GUC di sessione `audit.batch_tag`; se impostata non-vuota (via `set_config('audit.batch_tag', 'xxx', true)` all'interno di una RPC transazionale), salta l'inserimento per-riga. Attualmente usata solo come future-proofing: la soppressione client-side non funzionerebbe via PostgREST (connessioni pooled).

## Workflow Git

- **Production branch**: `main` → deploy Vercel produzione
- **Feature/review branch corrente**: nessuno attivo (tutti i branch `claude/*` recenti sono stati mergiati in `main` il 2026-04-23). Aprirne uno nuovo per ogni intervento; Vercel genera un preview URL per ciascuno.
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
