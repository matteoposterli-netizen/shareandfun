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
| `stabilimenti` | Stabilimento balneare, owned da un proprietario. Template email personalizzabili: `email_benvenuto_*`, `email_invito_*`, `email_credito_accreditato_*`, `email_credito_ritirato_*`, `email_chiusura_stagione_*` (fallback ai default in `js/email.js` se NULL). Le colonne `email_attesa_*`/`email_approvazione_*` esistono ancora nello schema ma non sono più esposte dalla UI (flow invite-only). Stagione: `data_inizio_stagione` / `data_fine_stagione` (date, default 1 giu / 15 set dell'anno corrente, CHECK fine ≥ inizio). Contabilità: `citta` (text nullable) — usato come breadcrumb nella Panoramica manager; se NULL il breadcrumb mostra solo `SPIAGGIAMIA · <nome>`. |
| `ombrelloni` | Ombrelloni di uno stabilimento (fila, numero, credito giornaliero) |
| `clienti_stagionali` | Clienti stagionali con `approvato`/`rifiutato`/`fonte` e `invito_token` per registrazione via link. **Nessuna registrazione autonoma**: esistono solo record creati dal proprietario (invito singolo o CSV); `user_id` viene popolato quando il cliente completa l'invito. **Vincolo**: UNIQUE INDEX parziale `clienti_stagionali_ombrellone_unique` su `(ombrellone_id) WHERE ombrellone_id IS NOT NULL` — un solo cliente assegnabile per ombrellone. NULL ombrellone_id (cliente non assegnato) ammesso su righe multiple. |
| `disponibilita` | Giornate in cui un ombrellone è messo a disposizione o sub-affittato. Colonna opzionale `nome_prenotazione` (text, nullable) per raggruppare sub-affitti multi-giorno / multi-ombrellone sotto una stessa etichetta visibile al gestore nella tab "Prenotazioni". |
| `transazioni` | Storico contabile (credito aggiunto/usato, sub-affitti). Colonna opzionale `categoria` (text nullable, CHECK `bar`/`ristorante`/`altro`) popolata solo per `tipo='credito_usato'` — alimenta il pie chart "Dove spendono" della Panoramica deep dive. NULL altrove. Indice `idx_transazioni_stab_tipo_created` su `(stabilimento_id, tipo, created_at DESC)` per le query KPI di range. Tipi supportati: `disponibilita_aggiunta`, `disponibilita_rimossa`, `sub_affitto`, `sub_affitto_annullato`, `credito_ricevuto`, `credito_usato`, `credito_revocato`, `regola_forzata_aggiunta`, `regola_forzata_rimossa` (questi ultimi due con `importo=0` — notifiche aggregate per cliente quando una regola di calendario viene impostata/rimossa). |
| `admins` | Account amministratori di sistema. PK `user_id` → `auth.users(id)`. **Non hanno riga in `profiles`**: le credenziali sono distinte dai proprietari/stagionali. Provisioning manuale via dashboard Supabase (vedi sezione "Area Admin"). |
| `audit_log` | Log delle modifiche fatte sullo stabilimento (INSERT/UPDATE/DELETE su tutte le tabelle business + login proprietario + email inviate + import batch + backup/reset/restore stagione). Populato via trigger `_audit_row_trigger` (SECURITY DEFINER) e RPC `audit_log_write` / `audit_coalesce_import`. RLS: proprietario vede solo i propri eventi, admin vede tutto. Retention 30 giorni via job `pg_cron` "audit-log-retention" (03:00 daily). `entity_type` include `regola_stato` (override di calendario) e `backup_stagione` (eventi `create_backup`/`reset`/`restore`). Vedi sezione "Audit log". |
| `regole_stato_ombrelloni` | Override di stato del calendario per range di date dello stabilimento. Tipi: `chiusura_speciale` (bagno chiuso, sub-affitti annullati automaticamente), `sempre_libero` (ombrelloni forzati subaffittabili, lo stagionale non può ritirarli), `mai_libero` (lo stagionale non può dichiarare libero). Granularità: stabilimento intero. La **chiusura stagionale** è derivata da `stabilimenti.data_*_stagione` e NON sta in questa tabella. Trigger audit `audit_regole_stato`. Modifiche solo via RPC `crea_regola_stato` / `elimina_regola_stato`. |
| `stagioni_backup` | Snapshot JSONB dello stato dello stabilimento (ombrelloni + clienti + disponibilità + transazioni) generato automaticamente prima di ogni reset stagione (oppure on-demand). RLS: proprietario vede solo i propri backup; nessuna policy INSERT/UPDATE/DELETE per il proprietario, le scritture passano dalle RPC SECURITY DEFINER (`crea_backup_stagione`, `reset_stagione`, `ripristina_backup`). FIFO cap 10 per stabilimento (gestito dentro `crea_backup_stagione`). |

RLS attiva ovunque. Policy consolidate (una per tabella/comando) con `(select auth.uid())` per performance. In aggiunta, ogni tabella business ha un set di policy `*_admin_*` che concedono accesso totale agli utenti presenti in `public.admins` (controllato via `public.is_admin(uid)` — SECURITY DEFINER). L'intero schema `public` (tabelle, FK, indexes, RLS, policies, RPC) è catturato come baseline in `supabase/migrations/20260420000000_baseline.sql`; migrazioni future vanno come file addizionali con timestamp successivo.

> Tutte le migrazioni in `supabase/migrations/` sono state applicate sul DB di produzione al 2026-04-26. Cumulative su `reset_stagione`: la 500000 rimpiazza la 300000 (reset dello stato di registrazione + cleanup auth.users per user_id), la 20260426000000 rimpiazza la 500000 (estende la cleanup auth.users anche al match per email + introduce la RPC `unblock_invito_email`).
>
> Applicare nuove migrazioni via Supabase dashboard (SQL Editor), `supabase db push` o `psql`.
>
> **Estensioni Postgres attive**: `pg_cron` (schedula il job di retention dell'audit log — richiede grant specifico, tipicamente pre-attivato nel dashboard Supabase → Database → Extensions).

### RPC functions (SECURITY DEFINER)

- `get_cliente_by_invito_token(p_token uuid)` — dati cliente pre-compilati per link invito
- `completa_registrazione_invito(p_token uuid, p_user_id uuid)` — finalizza signup da invito
- `cancel_booking(p_disp_ids uuid[])` — annullamento atomico di una prenotazione: verifica che il caller sia proprietario dello stabilimento implicato dalle disponibilità passate, riporta le righe a `libero`, inserisce le transazioni `sub_affitto_annullato` (+ `credito_revocato` e scrittura `credito_saldo` se c'è un cliente stagionale assegnato). Bypassa RLS tramite SECURITY DEFINER perché il flusso client-side equivalente falliva con `new row violates row-level security policy for table "transazioni"` in produzione.
- `audit_log_write(p_stabilimento_id, p_entity_type, p_action, p_description, p_entity_id?, p_metadata?)` — inserisce riga in `audit_log` per eventi non-DML (login, email, import batch, backup/reset/restore stagione). entity_type: `email`/`auth`/`import`/`backup_stagione`. action: `login`/`email_sent`/`import_batch`/`create_backup`/`reset`/`restore`. Autorizza proprietario, admin o service_role.
- `audit_coalesce_import(p_stabilimento_id, p_since, p_summary, p_metadata?)` — sostituisce gli eventi per-riga generati dai trigger durante un import Excel (entity_type IN ombrellone/cliente_stagionale/transazione/disponibilita, `actor_id = current_user`, `created_at >= p_since`) con un unico evento `import_batch`.
- `crea_regola_stato(p_stabilimento_id, p_tipo, p_data_da, p_data_a, p_nota?)` — crea una `regole_stato_ombrelloni`. Side-effects sulla tabella `disponibilita` per tenere il calendario stagionale e la mappa proprietario coerenti con la regola:
  - `chiusura_speciale` → annulla i `disponibilita.sub_affittato` nel range chiamando `cancel_booking()` (rimborso credito incluso).
  - `sempre_libero` → upsert `disponibilita stato='libero'` per ogni (ombrellone × giorno) del range, `ON CONFLICT (ombrellone_id, data) DO NOTHING` (preserva `libero`/`sub_affittato` già esistenti). `cliente_id` valorizzato col cliente assegnato all'ombrellone (NULL se nessuno).
  - `mai_libero` → `DELETE` delle `disponibilita.stato='libero'` esistenti nel range (i `sub_affittato` restano: bagno aperto, gestione manuale).

  In tutti i casi emette UNA transazione `regola_forzata_aggiunta` per ogni `clienti_stagionali` con `ombrellone_id` non NULL nello stabilimento (granularità aggregata: 1 riga per cliente, non per giorno). Verifica ownership.
- `elimina_regola_stato(p_regola_id)` — rimuove la regola e emette `regola_forzata_rimossa` aggregata. NON ripristina lo stato della tabella `disponibilita` precedente: i sub-affitti annullati da una `chiusura_speciale` restano cancellati, le `libero` inserite da `sempre_libero` restano (il cliente potrà toggleare off), le `libero` cancellate da `mai_libero` non vengono ricreate.
- `crea_backup_stagione(p_stabilimento_id, p_etichetta?)` — crea uno snapshot JSONB completo (stabilimento + ombrelloni + clienti + disponibilità + transazioni) e lo inserisce in `stagioni_backup`. Applica FIFO cap 10 (cancella i backup più vecchi se ne esistono già 10+). Audit log: `backup_stagione/create_backup`. Ritorna l'id del backup.
- `reset_stagione(p_stabilimento_id, p_mantieni_cb boolean)` — crea backup automatico, poi cancella `transazioni` + `disponibilita` dello stabilimento. Se `p_mantieni_cb=true` preserva anagrafica + ombrelloni MA azzera `credito_saldo` e resetta lo stato di registrazione (`user_id=NULL`, `invitato_at=NULL`, `approvato=false`, `rifiutato=false`, nuovo `invito_token`) — i clienti tornano "Mai invitato" e devono essere reinvitati per la nuova stagione; se `false` cancella anche `clienti_stagionali` e `ombrelloni`. Setta `audit.batch_tag` per sopprimere il rumore audit per-riga durante le DELETE/UPDATE massive. Ritorna l'id del backup. **Pulizia `auth.users` (v4)**: alla fine cancella le righe orfane di `auth.users` (cascata su `profiles`) sia per gli `user_id` collegati a `clienti_stagionali.user_id` al momento del reset, sia per gli `auth.users` matchati per **email** sui clienti dello stabilimento — questo copre il caso "invitato ma mai finalizzato" (signUp partito → auth.user creato → completa_registrazione_invito mai eseguito → cliente.user_id rimasto NULL). Filtri di orfanità invariati: niente altri `clienti_stagionali`, no `proprietario` in `profiles`, no `admins`. Senza questa pulizia il successivo `sb.auth.signUp` con la stessa email del cliente fallirebbe con "User already registered" (vedi migrazione `20260426000000_unblock_invito_email_and_reset_v4.sql`, che sostituisce `20260425500000_reset_stagione_delete_orphan_auth_users.sql`). Il check di sicurezza in `js/router.js → loadUserAndRoute` (sign-out automatico se `clienti_stagionali` con `user_id = auth.uid()` non esiste) resta valido come safety net per le sessioni già aperte al momento del reset.
- `unblock_invito_email(p_token uuid)` — RPC self-healing chiamata da `js/auth.js → completeInviteRegistration` quando `sb.auth.signUp` fallisce con "User already registered". Verifica che il token corrisponda a una `clienti_stagionali` con `user_id IS NULL`, poi cancella l'eventuale riga `auth.users` con la stessa email se davvero orfana (stessi filtri di `reset_stagione`). Ritorna `boolean`. Idempotente; il frontend riprova il signUp solo se la RPC ritorna `true`. Granted ad `anon` e `authenticated` (la sicurezza è garantita dal possesso del token + filtri di orfanità).
- `ripristina_backup(p_backup_id)` — crea un backup pre-restore (etichetta `Stato pre-ripristino del backup ...`), cancella lo stato corrente dello stabilimento (transazioni + disponibilita + clienti + ombrelloni), poi re-inserisce tutto via `jsonb_populate_recordset` dal payload del backup target. Audit log: `backup_stagione/restore` con metadata `pre_restore_backup_id`. Ritorna l'id del backup pre-restore.

### Edge Functions

- `invia-email` — invia email transazionali via Resend. Dominio mittente: `spiaggiamia.com` (verificato su Resend, DNS gestiti da Vercel). Tipi attivamente usati dalla UI:
  - `invito` (link personale via `invite_link`)
  - `benvenuto` (post-completamento invito; include CTA "Accedi a SpiaggiaMia" se viene passato `login_link`)
  - `credito_accreditato` (ad ogni inserimento di transazione `credito_ricevuto` — incluso il sub-affitto automatico)
  - `credito_ritirato` (ad ogni inserimento di transazione `credito_usato`)

  - `chiusura_stagione` (inviata dal proprietario a tutti i clienti registrati prima del reset stagione; include riepilogo personale: gg di disponibilità dichiarata, gg sub-affittati, coin ricevuti/spesi).

  Tutti accettano `oggetto_custom`/`testo_custom` (NL→`<br>` per `invito`/`credito_*`/`chiusura_stagione`); se omessi si usano i default. I tipi `credito_*` accettano anche `importo_formatted`, `saldo_formatted`, `nota`. Il tipo `chiusura_stagione` accetta `gg_disponibilita`, `gg_subaffittato`, `coin_ricevuti_formatted`, `coin_spesi_formatted` (il riepilogo viene sempre renderizzato dal template, anche con messaggio custom). Placeholders supportati nei template: `{{nome}}`, `{{cognome}}`, `{{ombrellone}}`, `{{importo}}`, `{{saldo}}`, `{{nota}}`, `{{stabilimento}}`, `{{gg_disponibilita}}`, `{{gg_subaffittato}}`, `{{coin_ricevuti}}`, `{{coin_spesi}}` (sostituiti lato client in `js/utils.js → substitutePlaceholders`). I tipi `attesa`/`approvazione` sono ancora supportati dalla function ma non più invocati dal frontend (registrazione è solo su invito). Dopo ogni invio riuscito, la function chiama `audit_log_write` (inoltrando il JWT del chiamante via header `Authorization`) per registrare un evento `email_sent` in `audit_log`; richiede `stabilimento_id` nel body della richiesta. JWT verify ON. Env richieste: `RESEND_API_KEY`, `FROM_EMAIL` (default fallback `SpiaggiaMia <noreply@spiaggiamia.com>`), `SUPABASE_SERVICE_ROLE_KEY`. **Attenzione**: la `RESEND_API_KEY` deve avere accesso al dominio `spiaggiamia.com` (permission "Full access" oppure "Sending access" con `spiaggiamia.com` selezionato). Una key ristretta a un altro dominio produce 500 con `statusCode:400 "The associated domain...key with full access or with a verified domain"`.

  **Reply-To freemail**: l'header `Reply-To` viene impostato su `stabilimento.email` solo se il dominio NON è freemail (gmail/yahoo/hotmail/libero/icloud/aol/gmx/protonmail/yandex/pec/…, vedi `FREEMAIL_DOMAIN_RE` in `index.ts`). Per i freemail il Reply-To resta sul From (`noreply@spiaggiamia.com`) per evitare la regola SpamAssassin `FREEMAIL_FORGED_REPLYTO` (-2.5). Il footer del template HTML/text segnala in modo esplicito che si tratta di un indirizzo no-reply e mostra i contatti del proprietario (telefono + email cliccabili via `tel:`/`mailto:`).

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

Tab "Log attività" lato proprietario (`#mtab-log` in `index.html`, logica in `js/audit.js`). Mostra tutti gli eventi registrati in `public.audit_log` per lo stabilimento del proprietario, con filtri (range date, tipo attore, entità, azione, testo libero, cliente/ombrellone coinvolto) e export Excel dei risultati filtrati. La colonna "Coinvolto" e il filtro "Cliente / Ombrellone" risolvono gli id contenuti nei payload `before`/`after` (e in `entity_id` quando `entity_type` è `ombrellone`/`cliente_stagionale`) contro le anagrafiche locali (`auditMaps` in `js/audit.js`, popolate da una singola fetch di `ombrelloni` + `clienti_stagionali` per stabilimento, cache invalidata al cambio stabilimento). Il filtro target costruisce un `or()` server-side combinando `entity_id.in.(...)` e `before/after->>ombrellone_id.in.(...)` / `cliente_id.in.(...)` — niente nuovi indici/colonne sull'`audit_log`.

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
- Il CSS è in `styles.css` (file separato linkato da `index.html`), non più inline. Le classi della Panoramica manager (`.pano-*`, `.dd-*`, `.kpi-delta-*`) sono in coda al file.
- Tab `mtab-panoramica` è guidato da `panoramicaInit()` in `js/panoramica.js`, invocato da `managerTab('panoramica')` e da `loadPanoramicaDefaultIfEmpty()` in `js/manager.js` (quest'ultima fa fallback alle vecchie KPI `loadDashboardUpcomingKpis`/`loadDashboardCreditsKpis` solo se il nuovo HTML non è presente). I deep dive (4 panel `dd-panel-*` dentro `mtab-panoramica`) sono placeholder in Consegna 1; verranno popolati in Consegna 2.
- `js/dd-common.js`: helpers condivisi tra Panoramica e deep dive (`dateRangeQS`, `previousRange`, `computeDelta`, `formatDeltaHTML`, `renderSparkline`, `groupByDay`, `fillSeries`, `dateRangeDays`, `exportXlsx`, `labelRange`).
- `js/configurazioni.js`: estratto dal vecchio `js/panoramica.js` per separare la logica della tab Configurazioni (`switchConfigSubtab`, `loadStagione`, `saveStagione`, `renderStagioneSummary`) dalla nuova Panoramica. Contiene anche il CRUD delle regole forzate (`loadRegoleStato`, `renderRegoleList`, `creaRegolaStato`, `eliminaRegolaStato`) — la UI è una card "Regole forzate sul calendario" sotto la card "Date della stagione corrente" nel sotto-tab Stagione (`#config-sub-stagione`). `creaRegolaStato` mostra un confirm prima di creare una `chiusura_speciale` se ci sono sub-affitti nel range. Lo switcher chiama `avanzateInit()` quando si attiva il sotto-tab `avanzate` e `loadBackupList()` quando si entra in `stagione`.
- `js/reset-stagione.js`: aggiunge in fondo al sotto-tab `Stagione` la card "Reset stagione" (wizard 3 step: scelta tipo `mantieni`/`totale` → riepilogo → conferma con digitazione del nome dello stabilimento) e la lista "Backup disponibili" (max 10 FIFO). Bottoni: scarica JSON del backup (download client-side), ripristina (modal con conferma forte + bottone "Scarica clienti attuali (Excel)" via SheetJS riusato dall'import). Tutte le mutazioni passano dalle RPC `crea_backup_stagione` / `reset_stagione` / `ripristina_backup`. **Step 2 del wizard** ha un checkbox "Invia email di chiusura stagione" (default ON): se attivo, prima di chiamare `reset_stagione` la funzione `sendChiusuraStagioneEmails` calcola per ogni cliente registrato (`user_id` non NULL, `email` valorizzata) il riepilogo (gg disponibilità da `disponibilita`, gg sub-affittati da `disponibilita.stato='sub_affittato'`, coin in/out aggregati dalle `transazioni` `credito_ricevuto`/`credito_usato`) e invia il tipo `chiusura_stagione`. Aggregazione client-side via 3 query bulk (clienti, disponibilita, transazioni) per evitare N+1. Le email vanno inviate prima del reset perché disponibilita/transazioni vengono cancellate.
- Pagina cliente stagionale (`#view-stagionale` in `index.html`, logica in `js/stagionale.js`, stili sotto `.stag-view` in `styles.css`): layout mobile-first single-column max 480px (centrato anche su desktop) con header teal self-contained che include logo + bottone "Esci" (`doLogout`). La topnav globale è nascosta sulla view tramite `body.view-stagionale` settata da `showView` in `js/router.js` (questa convenzione vale per qualunque view: il body porta `view-<id>` riflesso dalla view attiva). Body in due tab: "Calendario" (selettore rapido Oggi/Domani/Dopodomani + bottone weekend, "Come funziona" collassabile, calendario, stats giorni liberi/sub-affittati) e "Transazioni". Il selettore rapido e il toggle weekend usano `toggleDay` come il calendario, quindi le modifiche stagiano in `pendingDispChanges` e si committano via `salvaModifichePending` dalla barra "Salva modifiche / Annulla" che appare sotto il calendario quando ci sono modifiche pending. La lista transazioni qui è renderizzata da `renderStagTxList` (categorie `earn`/`spend`/`info`), non dal `renderTxList` del manager.
- Filtro calendario stagionale (`js/stagionale.js → renderCalendar` + `regolaStatoPerData`): i giorni fuori `data_inizio_stagione`/`data_fine_stagione` o coperti da regole sono marcati con la classe `restricted` (CSS in `styles.css`, pattern righe diagonali) e non sono cliccabili. Precedenza: `chiusura_speciale` > `mai_libero` > `sempre_libero`. Banner `#stag-stagione-banner` sopra il calendario mostra il range stagione. Le stesse restrizioni propagano al selettore rapido (bottoni disabilitati con tooltip della regola).
- Banner mappa proprietario (`js/manager.js → renderMapRegoleBanner`, target `#map-regole-banner`): mostra pill "Periodo fuori stagione", "Chiusura speciale attiva", "Sempre/Mai subaffittabile attiva" sopra la mappa quando il range scelto interseca le regole. Caricato a ogni `refreshMap`.
- `js/avanzate.js`: terzo sotto-tab di Configurazioni (`#config-sub-avanzate`). Diviso in due tab interni (`switchAvanzateSubtab` su `.avanzate-subtab` / `.avanzate-pane`):
  - **Azione massiva** (`#avanzate-pane-massiva`, default): mappa interattiva ombrelloni con range date (flatpickr + preset 1/2/3/7 gg / tutta la stagione). Click su un ombrellone apre `#modal-avanzate-omb` (scheda con stato per giorno nel range + bottoni per la singola modifica). Bottoni di massa sopra la mappa: forza disponibili / rimuovi tutte le disponibilità su tutti gli ombrelloni del periodo.
  - **Azione mirata su ombrellone** (`#avanzate-pane-mirata`): selezione di un singolo ombrellone via dropdown, poi visualizzazione inline di scheda cliente + lista giorno-per-giorno della stagione (`#mirata-day-list`, raggruppata per mese con header sticky). Per ogni giorno mostra eventuale regola attiva (`chiusura_speciale`/`mai_libero`/`sempre_libero`) + stato corrente (libero/sub_affittato/occupato) + bottone toggle (Rendi libero / Rimuovi). I sub-affitti già confermati e le `chiusura_speciale` sono read-only (annullamento solo dalla tab Prenotazioni). Bottoni di massa "tutta la stagione" e azioni anagrafica / saldo / cancellazione riusano i flussi esistenti (`openEditRowModal`, `deleteRow`, `modal-avanzate-saldo`).

  Tutte le mutazioni (singole, di massa, mirate) passano da `applyForceDisponibile` / `applyRemoveDisponibilita` (PostgREST con RLS proprietario, niente RPC nuove). La rettifica saldo coin genera una transazione `credito_ricevuto`/`credito_usato` con nota `Rettifica manuale gestore`. Audit log degli INSERT/DELETE è coperto dai trigger `_audit_row_trigger`. Il modal `modal-avanzate-saldo` è condiviso fra i due pane: la variabile `avanzateSaldoOrigin` (`'omb'` | `'mirata'`) traccia da dove è stato aperto per decidere a fine flusso se riaprire la scheda ombrellone o ricaricare la lista mirata.

## Mantenimento di questo file

Quando una sessione introduce un cambiamento **strutturale** — nuova tabella, nuova colonna/FK rilevante, nuova RPC, nuova Edge Function, nuovo env var, nuova convenzione, cambio di workflow git — **aggiorna `CLAUDE.md` nella stessa sessione** (preferibilmente nello stesso commit del cambiamento).

Un hook `Stop` in `.claude/settings.json` (→ `.claude/claude-md-reminder.sh`) controlla l'ultimo commit e il working tree: se `supabase/migrations/` o `supabase/functions/` cambiano senza che `CLAUDE.md` sia toccato, emette un reminder al termine del turno.
