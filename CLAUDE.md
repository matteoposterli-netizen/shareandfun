# SpiaggiaMia

Piattaforma in italiano per **sub-affitto di ombrelloni balneari stagionali**. Dominio: `spiaggiamia.com`.
Proprietari di stabilimento gestiscono clienti stagionali; i clienti possono rendere disponibili i propri ombrelloni per il sub-affitto giornaliero.

## Stack

- **Frontend**: SPA single-file (`index.html` ~2000 righe), HTML+CSS+JS inline, nessun build step. CDN `@supabase/supabase-js@2` + `SheetJS (xlsx)` per import/export Excel. Font DM Sans / DM Serif Display.
- **Backend**: Supabase (Postgres 17 + Auth + Edge Functions).
- **Email transazionali**: Resend via Edge Function `invia-email`.
- **WhatsApp transazionali**: Twilio Content Templates via Edge Function `invia-whatsapp` (abilitabile per stabilimento tramite `wa_enabled`).
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
| `stabilimenti` | Stabilimento balneare, owned da un proprietario. Template email personalizzabili: `email_benvenuto_*`, `email_invito_*`, `email_credito_accreditato_*`, `email_credito_ritirato_*`, `email_chiusura_stagione_*` (fallback ai default in `js/email.js` se NULL). Le colonne `email_attesa_*`/`email_approvazione_*` esistono ancora nello schema ma non sono più esposte dalla UI (flow invite-only). Stagione: `data_inizio_stagione` / `data_fine_stagione` (date, default 1 giu / 15 set dell'anno corrente, CHECK fine ≥ inizio). Contabilità: `citta` (text nullable) — usato come breadcrumb nella Panoramica manager; se NULL il breadcrumb mostra solo `SPIAGGIAMIA · <nome>`. `mappa_passerelle` (jsonb, default `[]`) — array di `{x, y}` per i passaggi nella mappa visiva. **WhatsApp** (`20260531100000_stabilimenti_wa_enabled.sql`): `wa_enabled` (boolean NOT NULL DEFAULT false) — attiva/disattiva notifiche WhatsApp automatiche per lo stabilimento; configurabile dal sub-tab Configurazioni → WhatsApp. Le credenziali Twilio sono a livello di piattaforma (env var della Edge Function `invia-whatsapp`). |
| `ombrelloni` | Ombrelloni di uno stabilimento. Identificatore: `codice` (text, NOT NULL, UNIQUE per stabilimento con vincolo `ombrelloni_stabilimento_id_codice_key`). Posizione nella mappa: `pos_x` / `pos_y` (integer, NOT NULL, default 0, UNIQUE per stabilimento con vincolo `ombrelloni_stabilimento_id_pos_key`). Le vecchie colonne `fila` (text) e `numero` (integer) sono state rimosse con la migrazione `20260524000000_ombrellone_codice_mappa.sql`. Colonna `attivo` (boolean, NOT NULL, DEFAULT true): se false l'ombrellone è disattivato — non prenotabile, non modificabile. Disattivazione via RPC `disattiva_ombrellone(p_ombrellone_id)` (cancella disponibilità future, restituisce sub-affitti impattati per warning UI). Riattivazione via `riattiva_ombrellone`. Bulk: `disattiva_ombrelloni_bulk(p_ids uuid[])`. Stato visibile su tutte le mappe con classe CSS `.ombrellone.inactive` (grigio barrato). Gestione solo lato proprietario. Email di notifica al cliente registrato (user_id NOT NULL) via tipo `ombrellone_disattivato` nell'Edge Function `invia-email`. |
| `clienti_stagionali` | Clienti stagionali con `approvato`/`rifiutato`/`fonte` e `invito_token` per registrazione via link. **Nessuna registrazione autonoma**: esistono solo record creati dal proprietario (invito singolo o CSV); `user_id` viene popolato quando il cliente completa l'invito. **Vincolo**: UNIQUE INDEX parziale `clienti_stagionali_ombrellone_unique` su `(ombrellone_id) WHERE ombrellone_id IS NOT NULL` — un solo cliente assegnabile per ombrellone. NULL ombrellone_id (cliente non assegnato) ammesso su righe multiple. **Consenso WhatsApp** (`20260531000000_whatsapp_consenso.sql`): `whatsapp_consenso` (boolean NOT NULL DEFAULT false) + `whatsapp_consenso_at` (timestamptz) — opt-in richiesto da Meta prima di inviare notifiche via Twilio. Il numero destinatario usa il campo `telefono` esistente. Le RLS policy esistenti coprono automaticamente i nuovi campi. |
| `disponibilita` | Giornate in cui un ombrellone è messo a disposizione o sub-affittato. Colonna opzionale `nome_prenotazione` (text, nullable) per raggruppare sub-affitti multi-giorno / multi-ombrellone sotto una stessa etichetta visibile al gestore nella tab "Prenotazioni". **Convenzione "default-libero"** (introdotta con `20260427000000_default_libero_ombrelloni.sql`): `stato='libero' AND cliente_id IS NULL` = ombrellone subaffittabile **senza** cliente stagionale assegnato (nessun accredito coin); `stato='libero' AND cliente_id NOT NULL` = libero dichiarato dallo stagionale; `stato='sub_affittato' AND cliente_id IS NULL` = sub-affitto su ombrellone non assegnato (no accredito); `stato='sub_affittato' AND cliente_id NOT NULL` = sub-affitto con accredito al cliente. **FK `cliente_id` ON DELETE SET NULL** (era CASCADE): cancellare un cliente preserva lo storico delle disponibilità (cliente_id passa a NULL). |
| `transazioni` | Storico contabile (credito aggiunto/usato, sub-affitti). Colonna opzionale `categoria` (text nullable, CHECK `bar`/`ristorante`/`altro`) popolata solo per `tipo='credito_usato'` — alimenta il pie chart "Dove spendono" della Panoramica deep dive. NULL altrove. Indice `idx_transazioni_stab_tipo_created` su `(stabilimento_id, tipo, created_at DESC)` per le query KPI di range. Tipi supportati: `disponibilita_aggiunta`, `disponibilita_rimossa`, `sub_affitto`, `sub_affitto_annullato`, `credito_ricevuto`, `credito_usato`, `credito_revocato`, `regola_forzata_aggiunta`, `regola_forzata_rimossa` (questi ultimi due con `importo=0` — notifiche aggregate per cliente quando una regola di calendario viene impostata/rimossa), `comunicazione_ricevuta` (importo=0, una riga per cliente destinatario di una email broadcast inviata dal tab "Comunicazioni"; `nota` contiene oggetto + estratto del corpo). |
| `email_bozze` | Bozze riutilizzabili delle email broadcast (tab "Comunicazioni" → Email). Una riga per (stabilimento, etichetta): UNIQUE INDEX `email_bozze_stab_etichetta_unique` su `(stabilimento_id, etichetta)`. Colonne: `etichetta` (1–80 char), `oggetto` (≤200), `corpo` (≤8000), `created_at`, `updated_at`. Trigger BEFORE UPDATE `email_bozze_touch_updated_at` aggiorna `updated_at`. RLS: proprietario CRUD sulla propria customer base + policy admin. Niente trigger audit (modifiche alle bozze non vengono loggate). |
| `admins` | Account amministratori di sistema. PK `user_id` → `auth.users(id)`. **Non hanno riga in `profiles`**: le credenziali sono distinte dai proprietari/stagionali. Provisioning manuale via dashboard Supabase (vedi sezione "Area Admin"). |
| `audit_log` | Log delle modifiche fatte sullo stabilimento (INSERT/UPDATE/DELETE su tutte le tabelle business + login proprietario + email inviate + import batch + backup/reset/restore stagione). Populato via trigger `_audit_row_trigger` (SECURITY DEFINER) e RPC `audit_log_write` / `audit_coalesce_import`. RLS: proprietario vede solo i propri eventi, admin vede tutto. Retention 30 giorni via job `pg_cron` "audit-log-retention" (03:00 daily). `entity_type` include `regola_stato` (override di calendario) e `backup_stagione` (eventi `create_backup`/`reset`/`restore`). Vedi sezione "Audit log". |
| `regole_stato_ombrelloni` | Override di stato del calendario per range di date dello stabilimento. Tipi: `chiusura_speciale` (bagno chiuso, sub-affitti annullati automaticamente), `sempre_libero` (ombrelloni forzati subaffittabili, lo stagionale non può ritirarli), `mai_libero` (lo stagionale non può dichiarare libero). Granularità: stabilimento intero. La **chiusura stagionale** è derivata da `stabilimenti.data_*_stagione` e NON sta in questa tabella. Trigger audit `audit_regole_stato`. Modifiche solo via RPC `crea_regola_stato` / `elimina_regola_stato`. |
| `stagioni_backup` | Snapshot JSONB dello stato dello stabilimento (ombrelloni + clienti + disponibilità + transazioni) generato automaticamente prima di ogni reset stagione (oppure on-demand). RLS: proprietario vede solo i propri backup; nessuna policy INSERT/UPDATE/DELETE per il proprietario, le scritture passano dalle RPC SECURITY DEFINER (`crea_backup_stagione`, `reset_stagione`, `ripristina_backup`). FIFO cap 10 per stabilimento (gestito dentro `crea_backup_stagione`). |

RLS attiva ovunque. Policy consolidate (una per tabella/comando) con `(select auth.uid())` per performance. In aggiunta, ogni tabella business ha un set di policy `*_admin_*` che concedono accesso totale agli utenti presenti in `public.admins` (controllato via `public.is_admin(uid)` — SECURITY DEFINER). L'intero schema `public` (tabelle, FK, indexes, RLS, policies, RPC) è catturato come baseline in `supabase/migrations/20260420000000_baseline.sql`; migrazioni future vanno come file addizionali con timestamp successivo.

**Convenzione timestamp**: tutte le colonne `created_at` (e simili) devono essere `timestamptz`. Il baseline le aveva definite come `timestamp` (naive) sulle 6 tabelle business — convertite a `timestamptz` con la migrazione `20260429010000_created_at_to_timestamptz.sql` (USING `AT TIME ZONE 'UTC'`, dato che Supabase scrive `now()` in sessioni UTC). Senza tz PostgREST le serializza senza marker e il browser le interpreta come ora locale, mostrando -2h in CEST. Le tabelle aggiunte dopo il baseline (audit_log, regole_stato_ombrelloni, stagioni_backup, email_bozze, admins) erano già timestamptz.

> Tutte le migrazioni in `supabase/migrations/` sono state applicate sul DB di produzione. **Ultima migration applicata**: `20260602000001_drop_whatsapp_config.sql` (drop tabella `whatsapp_config`, resa obsoleta dalla gestione centralizzata via env var). Inclusa la `20260524000000_ombrellone_codice_mappa.sql` (aggiunta `codice`/`pos_x`/`pos_y` a `ombrelloni`, `mappa_passerelle` a `stabilimenti`, drop `fila`/`numero`) — applicata in produzione. Cumulative su `reset_stagione`: la 500000 rimpiazza la 300000 (reset dello stato di registrazione + cleanup auth.users per user_id), la 20260426000000 rimpiazza la 500000 (estende la cleanup auth.users anche al match per email + introduce la RPC `unblock_invito_email`).
>
> Applicare nuove migrazioni via Supabase dashboard (SQL Editor), `supabase db push` o `psql`.
>
> **Estensioni Postgres attive**: `pg_cron` (schedula il job di retention dell'audit log — richiede grant specifico, tipicamente pre-attivato nel dashboard Supabase → Database → Extensions).

### RPC functions (SECURITY DEFINER)

- `get_cliente_by_invito_token(p_token uuid)` — dati cliente pre-compilati per link invito
- `completa_registrazione_invito(p_token uuid, p_user_id uuid)` — finalizza signup da invito
- `risolvi_login_da_telefono(p_telefono text) -> text` — dato un telefono in qualsiasi formato (normalizzato via `_normalize_phone_e164`), ritorna l'email su `auth.users` del cliente registrato corrispondente (vera o sintetica), oppure NULL se non trovato (no enumeration). Granted ad `anon`+`authenticated`. Usata dal form di login per consentire l'accesso con telefono (`20260603120000_login_email_o_telefono.sql`).
- `rigenera_invito_token(p_cliente_id uuid) -> uuid` — rigenera il `invito_token` di un cliente stagionale (solo proprietario dello stabilimento; verifica `stabilimenti.proprietario_id = auth.uid()`), invalida il token precedente e resetta `invitato_at = NULL`. Granted ad `authenticated` (`20260603120000_login_email_o_telefono.sql`).
- `_normalize_phone_e164(raw text) -> text` (IMMUTABLE) — normalizza un numero in E.164 (+39 default ITA), coerente con `normalizzaTelefonoIT()` in `js/utils.js`. Usata dal trigger `trg_clienti_normalize_phone` (BEFORE INSERT/UPDATE OF telefono su `clienti_stagionali`) e da `risolvi_login_da_telefono`. Unique index parziale `uniq_telefono_clienti_registrati` su `(telefono) WHERE user_id IS NOT NULL` garantisce unicità del telefono tra clienti registrati (`20260603120000_login_email_o_telefono.sql`).
- `cancel_booking(p_disp_ids uuid[])` — annullamento atomico di una prenotazione: verifica che il caller sia proprietario dello stabilimento implicato dalle disponibilità passate, riporta le righe a `libero`, inserisce le transazioni `sub_affitto_annullato` (+ `credito_revocato` e scrittura `credito_saldo` se c'è un cliente stagionale assegnato). Bypassa RLS tramite SECURITY DEFINER perché il flusso client-side equivalente falliva con `new row violates row-level security policy for table "transazioni"` in produzione.
- `audit_log_write(p_stabilimento_id, p_entity_type, p_action, p_description, p_entity_id?, p_metadata?)` — inserisce riga in `audit_log` per eventi non-DML (login, email, import batch, backup/reset/restore stagione, email broadcast). entity_type: `email`/`auth`/`import`/`backup_stagione`. action: `login`/`email_sent`/`import_batch`/`create_backup`/`reset`/`restore`/`email_batch_sent`. Autorizza proprietario, admin o service_role.
- `audit_coalesce_import(p_stabilimento_id, p_since, p_summary, p_metadata?)` — sostituisce gli eventi per-riga generati dai trigger durante un import Excel (entity_type IN ombrellone/cliente_stagionale/transazione/disponibilita, `actor_id = current_user`, `created_at >= p_since`) con un unico evento `import_batch`.
- `crea_regola_stato(p_stabilimento_id, p_tipo, p_data_da, p_data_a, p_nota?)` — crea una `regole_stato_ombrelloni`. Side-effects sulla tabella `disponibilita` per tenere il calendario stagionale e la mappa proprietario coerenti con la regola:
  - `chiusura_speciale` → annulla i `disponibilita.sub_affittato` nel range chiamando `cancel_booking()` (rimborso credito incluso).
  - `sempre_libero` → upsert `disponibilita stato='libero'` per ogni (ombrellone × giorno) del range, `ON CONFLICT (ombrellone_id, data) DO NOTHING` (preserva `libero`/`sub_affittato` già esistenti). `cliente_id` valorizzato col cliente assegnato all'ombrellone (NULL se nessuno).
  - `mai_libero` → `DELETE` delle `disponibilita.stato='libero'` esistenti nel range (i `sub_affittato` restano: bagno aperto, gestione manuale).

  In tutti i casi emette UNA transazione `regola_forzata_aggiunta` per ogni `clienti_stagionali` con `ombrellone_id` non NULL nello stabilimento (granularità aggregata: 1 riga per cliente, non per giorno). Verifica ownership.
- `elimina_regola_stato(p_regola_id)` — rimuove la regola, fa il **rollback** dei side-effect su `disponibilita` (per quanto possibile) ed emette `regola_forzata_rimossa` aggregata. Comportamento per tipo (introdotto con `20260503000000_elimina_regola_rollback.sql`):
  - `sempre_libero` → DELETE delle righe `libero` nel range della regola per tutti gli ombrelloni dello stabilimento (i `sub_affittato` non vengono toccati). Per gli ombrelloni con cliente l'effetto è "torna occupato dal cliente"; per quelli senza cliente la successiva ri-materializzazione default-libero li riporta subaffittabili senza cliente.
  - `mai_libero` → niente da DELETEare (le `libero` cancellate alla creazione non sono backuppate). I giorni del range tornano comunque subaffittabili di default per gli ombrelloni senza cliente via ri-materializzazione.
  - `chiusura_speciale` → i sub-affitti annullati restano cancellati (sono già stati rimborsati nel ledger). Per gli ombrelloni senza cliente i giorni tornano default-libero.

  In tutti i casi alla fine viene chiamato `_materialize_default_libero` su ogni ombrellone senza cliente assegnato dello stabilimento (rispetta `mai_libero`/`chiusura_speciale` ancora attive). audit per-row del DELETE bulk soppresso via `audit.batch_tag`.
- `crea_backup_stagione(p_stabilimento_id, p_etichetta?)` — crea uno snapshot JSONB completo (stabilimento + ombrelloni + clienti + disponibilità + transazioni) e lo inserisce in `stagioni_backup`. Applica FIFO cap 10 (cancella i backup più vecchi se ne esistono già 10+). Audit log: `backup_stagione/create_backup`. Ritorna l'id del backup.
- `reset_stagione(p_stabilimento_id, p_mantieni_cb boolean)` — crea backup automatico, poi cancella `transazioni` + `disponibilita` dello stabilimento. Se `p_mantieni_cb=true` preserva anagrafica + ombrelloni MA azzera `credito_saldo` e resetta lo stato di registrazione (`user_id=NULL`, `invitato_at=NULL`, `approvato=false`, `rifiutato=false`, nuovo `invito_token`) — i clienti tornano "Mai invitato" e devono essere reinvitati per la nuova stagione; se `false` cancella anche `clienti_stagionali` e `ombrelloni`. Setta `audit.batch_tag` per sopprimere il rumore audit per-riga durante le DELETE/UPDATE massive. Ritorna l'id del backup. **Pulizia `auth.users` (v4)**: alla fine cancella le righe orfane di `auth.users` (cascata su `profiles`) sia per gli `user_id` collegati a `clienti_stagionali.user_id` al momento del reset, sia per gli `auth.users` matchati per **email** sui clienti dello stabilimento — questo copre il caso "invitato ma mai finalizzato" (signUp partito → auth.user creato → completa_registrazione_invito mai eseguito → cliente.user_id rimasto NULL). Filtri di orfanità invariati: niente altri `clienti_stagionali`, no `proprietario` in `profiles`, no `admins`. Senza questa pulizia il successivo `sb.auth.signUp` con la stessa email del cliente fallirebbe con "User already registered" (vedi migrazione `20260426000000_unblock_invito_email_and_reset_v4.sql`, che sostituisce `20260425500000_reset_stagione_delete_orphan_auth_users.sql`). Il check di sicurezza in `js/router.js → loadUserAndRoute` (sign-out automatico se `clienti_stagionali` con `user_id = auth.uid()` non esiste) resta valido come safety net per le sessioni già aperte al momento del reset.
- `unblock_invito_email(p_token uuid)` — RPC self-healing chiamata da `js/auth.js → completeInviteRegistration` quando `sb.auth.signUp` fallisce con "User already registered". Verifica che il token corrisponda a una `clienti_stagionali` con `user_id IS NULL`, poi cancella l'eventuale riga `auth.users` con la stessa email se davvero orfana (stessi filtri di `reset_stagione`). Ritorna `boolean`. Idempotente; il frontend riprova il signUp solo se la RPC ritorna `true`. Granted ad `anon` e `authenticated` (la sicurezza è garantita dal possesso del token + filtri di orfanità).
- `cancella_account_proprietario()` — cancella irreversibilmente tutti i dati del proprietario autenticato: audit_log → email_bozze → stagioni_backup → regole_stato_ombrelloni → transazioni → disponibilita → clienti_stagionali → ombrelloni → stabilimenti → auth.users (ordine critico per i vincoli FK e i trigger audit). Verifica che `auth.uid()` abbia ruolo `proprietario` in `profiles`. SECURITY DEFINER con `search_path = public`. Granted solo a `authenticated`. Callable da frontend via `sb.rpc('cancella_account_proprietario')`. UI: card "⚠️ Zona pericolosa" nel sotto-tab "Account" di Configurazioni (`#config-sub-account`, logica in `js/account.js`), con modal di conferma (`modal-cancella-account`) che richiede di digitare `ELIMINA`. Dopo successo: sign-out locale e redirect a `/`. Migrazioni: `20260524100000_cancella_account_proprietario.sql` (versione originale), `20260525000000_cancella_account_proprietario.sql` (aggiunge check ruolo proprietario + `LIMIT 1`).
- `ripristina_backup(p_backup_id)` — crea un backup pre-restore (etichetta `Stato pre-ripristino del backup ...`), cancella lo stato corrente dello stabilimento (transazioni + disponibilita + clienti + ombrelloni), poi re-inserisce tutto via `jsonb_populate_recordset` dal payload del backup target. Audit log: `backup_stagione/restore` con metadata `pre_restore_backup_id`. Ritorna l'id del backup pre-restore.

**Logica "default-libero" per ombrelloni senza cliente stagionale** (`20260427000000_default_libero_ombrelloni.sql`):
- `_materialize_default_libero(p_ombrellone_id uuid)` — INSERT righe `disponibilita stato='libero' cliente_id=NULL` per ogni giorno della stagione (`max(current_date, data_inizio_stagione)..data_fine_stagione`), saltando i giorni coperti da regole `mai_libero`/`chiusura_speciale`. `ON CONFLICT (ombrellone_id, data) DO NOTHING` (idempotente).
- `_assegna_cliente_a_ombrellone(p_cliente_id, p_ombrellone_id)` — promuove i sub-affitti futuri (`data >= current_date`, `cliente_id IS NULL`, `stato='sub_affittato'`) al nuovo cliente: per ciascuno aggiorna `cliente_id`, inserisce una transazione `credito_ricevuto` e aggiorna `clienti_stagionali.credito_saldo`. Cancella le righe default-libero future (`libero+cliente_id=NULL`) per liberare i giorni rimanenti che il cliente potrà dichiarare libero dalla sua app.
- `_rilascia_cliente_da_ombrellone(p_cliente_id, p_ombrellone_id)` — caso disassegnazione: le `libero+cliente_id=p_cliente_id` future tornano `cliente_id=NULL` (default-libero); i sub-affitti futuri con `cliente_id=p_cliente_id` restano intatti (storico immutabile, A si tiene i coin); poi richiama `_materialize_default_libero` per coprire i giorni scoperti.
- **Trigger `ombrelloni_default_libero_after_insert`** AFTER INSERT su `ombrelloni` → chiama `_materialize_default_libero(NEW.id)` (audit soppresso via `audit.batch_tag` per evitare 100+ righe per-riga).
- **Trigger `clienti_assignment_change_after`** AFTER INSERT/UPDATE/DELETE su `clienti_stagionali` → se `OLD.ombrellone_id IS DISTINCT FROM NEW.ombrellone_id`, chiama in sequenza `_rilascia_cliente_da_ombrellone(OLD)` e `_assegna_cliente_a_ombrellone(NEW)` (uno o entrambi a seconda di assegnazione/disassegnazione/riassegnazione/INSERT/DELETE). Audit non soppresso (le UPDATE puntuali sono utili per il log attività).
- **Frontend confirm dialog** (`#modal-assign-confirm` in `index.html`, helper `previewAssignmentEffect` + `confirmAssignmentDialog` in `js/manager.js`): prima di ogni UPDATE su `clienti_stagionali.ombrellone_id` (modal "Aggiungi" e "Modifica" del proprietario), il client calcola il numero di sub-affitti futuri con `cliente_id IS NULL` su quell'ombrellone e mostra il totale che verrà accreditato. L'import Excel aggira il dialog (i trigger DB applicano comunque la logica di assegnazione, ma senza UI di conferma per non interrompere il batch).
- **UI mappa**: classe CSS `.ombrellone.free.no-cliente` (azzurro chiaro, bordo tratteggiato) per distinguere visivamente gli ombrelloni in stato default-libero. Applicata in `js/manager.js → renderManagerMap` e `js/avanzate.js → renderAvanzateMap`. Legend aggiornata in `index.html` per le mappe della tab Manager e di Avanzate.
- **Backfill produzione**: la migrazione esegue inline `_materialize_default_libero` su tutti gli ombrelloni esistenti senza cliente assegnato (`audit.batch_tag` settato per sopprimere il rumore audit del backfill). Idempotente.

### Edge Functions

- `invia-whatsapp` — invia notifiche WhatsApp via Twilio Programmable Messaging (Content Templates). JWT verify ON (accetta anche la `SUPABASE_SERVICE_ROLE_KEY` come bearer per chiamate server-to-server, es. da `recupero-password`, bypassando `auth.getUser`). Env richieste: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WA_FROM` (es. `whatsapp:+39…`), `WA_SID_INVITO`, `WA_SID_BENVENUTO`, `WA_SID_SUBAFFITTO`, `WA_SID_RECUPERO` (Content SID HX… dei template; `WA_SID_RECUPERO` opzionale finché Meta non approva il template). Tipi supportati:
  - `invito` — bottone "Crea password" con link `/?invito=<token>`. Params: `cliente_id`, `token`.
  - `benvenuto` — messaggio di benvenuto post-registrazione. Params: `cliente_id`.
  - `subaffitto_confermato` — notifica guadagno coin. Params: `cliente_id`, `periodo`, `coin_guadagnati`, `coin_totali`.
  - `recupero_password` — link di reset password via WhatsApp. Params: `cliente_id`, `link` (recovery URL). Variabili template: `{{1}}`=stabilimento (header), `{{2}}`=nome, `{{3}}`=stabilimento (body), `{{4}}`=link. **Bypassa** il controllo `whatsapp_consenso` (è comunicazione di servizio). Se `WA_SID_RECUPERO` non è valorizzata risponde `{ skipped: "template_recupero_non_configurato" }`.
  Precondizioni (verificate dalla function): `stabilimenti.wa_enabled = true`, `clienti_stagionali.whatsapp_consenso = true` (tranne `recupero_password`), `telefono` valido (normalizzato in E.164 da `normalizePhone()`). Se una precondizione non è soddisfatta risponde `{ ok: false, skipped: "<reason>" }` senza errore. Le chiamate avvengono in fire-and-forget da `inviaWhatsapp()` in `js/utils.js` dopo il rispettivo `inviaEmail`.

- `recupero-password` — gestisce SOLO il ramo telefono del recupero password (il ramo email è lato client via `sb.auth.resetPasswordForEmail()`). Input `{ identificatore, canale: 'telefono' }`; risposta sempre generica `{ ok: true }` (no enumeration). Flusso: normalizza telefono → trova cliente registrato → `auth.admin.getUserById` per l'email auth (vera o sintetica) → `auth.admin.generateLink({type:'recovery'})` con redirect `APP_URL/?reset=1` → invia via `invia-whatsapp` tipo `recupero_password`. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL` (default `https://spiaggiamia.com`).
  **Variabile bottone invito**: in Twilio il bottone CTA ha numerazione variabili indipendente dal body. L'Edge Function usa `"button_1_url_0": token` in ContentVariables — verificare il comportamento con i SID reali e aggiustare se necessario (alternativa: chiave `"3"` se Twilio numera globalmente).

- `invia-email` — invia email transazionali via Resend. Dominio mittente: `spiaggiamia.com` (verificato su Resend, DNS gestiti da Vercel). Tipi attivamente usati dalla UI:
  - `invito` (link personale via `invite_link`)
  - `benvenuto` (post-completamento invito; include CTA "Accedi a SpiaggiaMia" se viene passato `login_link`)
  - `credito_accreditato` (ad ogni inserimento di transazione `credito_ricevuto` — incluso il sub-affitto automatico)
  - `credito_ritirato` (ad ogni inserimento di transazione `credito_usato`)

  - `chiusura_stagione` (inviata dal proprietario a tutti i clienti registrati prima del reset stagione; include riepilogo personale: gg di disponibilità dichiarata, gg sub-affittati, coin ricevuti/spesi).
  - `comunicazione` (broadcast libero dal tab "Comunicazioni" del manager; `oggetto_custom` + `testo_custom` obbligatori, NL→`<br>`; renderizzato nel template standard con `boxTitolo=oggetto`, `boxTesto=corpo` e header coral SpiaggiaMia).
  - `ombrellone_disattivato` (inviata al cliente stagionale registrato — user_id IS NOT NULL — quando il proprietario disattiva il suo ombrellone; colore coral/arancio, nessun template personalizzabile per ora).

  Tutti accettano `oggetto_custom`/`testo_custom` (NL→`<br>` per `invito`/`credito_*`/`chiusura_stagione`/`comunicazione`); se omessi si usano i default (eccetto `comunicazione` che li richiede obbligatoriamente). I tipi `credito_*` accettano anche `importo_formatted`, `saldo_formatted`, `nota`. Il tipo `chiusura_stagione` accetta `gg_disponibilita`, `gg_subaffittato`, `coin_ricevuti_formatted`, `coin_spesi_formatted` (il riepilogo viene sempre renderizzato dal template, anche con messaggio custom). Placeholders supportati nei template: `{{nome}}`, `{{cognome}}`, `{{ombrellone}}`, `{{importo}}`, `{{saldo}}`, `{{nota}}`, `{{stabilimento}}`, `{{gg_disponibilita}}`, `{{gg_subaffittato}}`, `{{coin_ricevuti}}`, `{{coin_spesi}}` (sostituiti lato client in `js/utils.js → substitutePlaceholders`). I tipi `attesa`/`approvazione` sono ancora supportati dalla function ma non più invocati dal frontend (registrazione è solo su invito). Dopo ogni invio riuscito, la function chiama `audit_log_write` (inoltrando il JWT del chiamante via header `Authorization`) per registrare un evento `email_sent` in `audit_log`; richiede `stabilimento_id` nel body della richiesta. JWT verify ON. Env richieste: `RESEND_API_KEY`, `FROM_EMAIL` (default fallback `SpiaggiaMia <noreply@spiaggiamia.com>`), `SUPABASE_SERVICE_ROLE_KEY`. **Attenzione**: la `RESEND_API_KEY` deve avere accesso al dominio `spiaggiamia.com` (permission "Full access" oppure "Sending access" con `spiaggiamia.com` selezionato). Una key ristretta a un altro dominio produce 500 con `statusCode:400 "The associated domain...key with full access or with a verified domain"`.

  **Reply-To freemail**: l'header `Reply-To` viene impostato su `stabilimento.email` solo se il dominio NON è freemail (gmail/yahoo/hotmail/libero/icloud/aol/gmx/protonmail/yandex/pec/…, vedi `FREEMAIL_DOMAIN_RE` in `index.ts`). Per i freemail il Reply-To resta sul From (`noreply@spiaggiamia.com`) per evitare la regola SpamAssassin `FREEMAIL_FORGED_REPLYTO` (-2.5). Il footer del template HTML/text segnala in modo esplicito che si tratta di un indirizzo no-reply e mostra i contatti del proprietario (telefono + email cliccabili via `tel:`/`mailto:`).

## Flow registrazione clienti stagionali (invite-only)

Dalla riorganizzazione `claude/beach-invite-only-registration-wlsjM` gli stagionali **non possono più registrarsi autonomamente**. Percorsi supportati:

1. **Aggiunta singola**: proprietario apre modal "+ Aggiungi" nel tab "Ombrelloni e Clienti" → crea/aggiorna l'ombrellone e opzionalmente il cliente (+ invito email `invito` con link `/?invito=<token>`).
2. **Importazione massiva via Excel**: upload `.xlsx` nel tab "Ombrelloni e Clienti" → upsert ombrelloni + clienti + invio email invito in batch. Colonne supportate: `codice, credito_giornaliero, nome, cognome, telefono, email` (cliente opzionale). Vecchi file con `fila`/`numero` vengono rifiutati con messaggio esplicito.
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

## Comunicazioni (broadcast email)

Tab top-level del manager (`mtab-comunicazioni` in `index.html`, logica in `js/comunicazioni.js`). Tre sotto-tab: **Email** (attivo), **WhatsApp** (placeholder UI con banner "Stiamo lavorando…"), **SMS** (placeholder UI). L'init è triggerato da `managerTab('comunicazioni')` in `js/manager.js → managerTab` e chiama `comunicazioniInit()` che carica bozze e clienti.

**Selezione destinatari** (4 modalità mutuamente esclusive — radio):
- `all` — tutti i clienti dello stabilimento con email valorizzata.
- `filter` — multi-select sulle file + range numerico `da`/`a` (entrambi opzionali, AND logico).
- `manual` — multi-select libero su lista clienti con search box e bottoni "Seleziona/Deseleziona tutti" (rispetta il filtro di ricerca corrente).
- `single` — dropdown su un cliente singolo.

I clienti senza email sono sempre esclusi dal pool inviabile, ma il riepilogo destinatari mostra il count "non raggiungibili" prima dell'invio.

**Contenuto**: oggetto (max 200 char) + corpo (max 8000 char). Placeholder supportati lato client via `substitutePlaceholders` (`js/utils.js`): `{{nome}}`, `{{cognome}}`, `{{ombrellone}}`, `{{stabilimento}}` — sostituiti per ciascun destinatario al momento dell'invio. **Anteprima** modal renderizza il template SpiaggiaMia con i dati del primo destinatario.

**Bozze** (`email_bozze`):
- Salva nuova bozza (modal `#modal-comm-bozza` con prompt etichetta) — UPSERT con `onConflict: 'stabilimento_id,etichetta'`, quindi riusare lo stesso nome sovrascrive.
- Carica bozza (dropdown popolato da `loadCommBozze`) — popola oggetto/corpo e abilita "Sovrascrivi".
- Sovrascrivi — UPDATE della bozza correntemente caricata col contenuto attuale (con conferma).
- Niente "rinomina" o "elimina" lato UI (richiesta esplicita); per cancellare una bozza si va da admin SQL.

**Invio** (`comunicazioniInvia`):
1. Conferma standard `confirm()` con count destinatari + esclusi.
2. Modal progress (`#modal-comm-invio`) con barra progresso e meta `done/total`.
3. Loop sequenziale con throttle `COMM_THROTTLE_MS=110` (~9 req/sec, sotto al limite Resend 10/sec).
4. Per ogni invio riuscito: chiama Edge Function `invia-email` con `tipo='comunicazione'` + insert riga `transazioni` con `tipo='comunicazione_ricevuta'`, `importo=0`, `cliente_id=destinatario`, `nota=oggetto\nestratto-corpo` (estratto = primi 200 char del corpo). La Edge Function logga già una riga `email/email_sent` per cliente in `audit_log`.
5. A fine batch, RPC `audit_log_write` con `entity_type='email'`, `action='email_batch_sent'`, `metadata={tipo, oggetto, inviati, falliti, esclusi_senza_email, falliti_lista}` — evento aggregato lato proprietario.
6. Modal finale: count successi + falliti (con `<details>` per la lista completa) + count esclusi senza email.

**Lista transazioni del cliente stagionale**: `js/stagionale.js → stagTxLabel` ha un case dedicato per `comunicazione_ricevuta` che mostra "📣 Comunicazione: <oggetto>" leggendo la prima riga della `nota`. Categoria visiva: `info` (grigio, importo nascosto perché 0). Anche `js/transazioni.js → TX_TAB_LABELS` lato manager espone "Comunicazione ricevuta" come tipo selezionabile nel filtro.

**Tab WhatsApp / SMS**: `<fieldset disabled>` con anteprima del layout futuro (selettori destinatari + textarea + bottone Invia tutti disabilitati) sotto un banner "🚧 Stiamo lavorando a questa funzionalità". Niente logica JS attiva.

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
- `js/configurazioni.js`: estratto dal vecchio `js/panoramica.js` per separare la logica della tab Configurazioni (`switchConfigSubtab`, `loadStagione`, `saveStagione`, `renderStagioneSummary`) dalla nuova Panoramica. Contiene anche il CRUD delle regole forzate (`loadRegoleStato`, `renderRegoleList`, `creaRegolaStato`, `eliminaRegolaStato`) — la UI è una card "Regole forzate sul calendario" sotto la card "Date della stagione corrente" nel sotto-tab Stagione (`#config-sub-stagione`). `creaRegolaStato` mostra un confirm prima di creare una `chiusura_speciale` se ci sono sub-affitti nel range. Lo switcher chiama `avanzateInit()` quando si attiva il sotto-tab `avanzate`, `accountLoad()` quando si entra in `account` e `loadBackupList()` quando si entra in `stagione`.
- `js/account.js`: sotto-tab "Account" di Configurazioni (`#config-sub-account`). Tre card: (1) "Dati del tuo account" — lettura/scrittura di `profiles.nome`, `profiles.cognome`, `profiles.telefono` + email read-only da `auth.users` (`accountLoad`, `accountSaveProfilo`); (2) "Cambia password" — `sb.auth.updateUser({ password })` con validazione lunghezza/match (`accountChangePassword`); (3) "Zona pericolosa" — bottone che apre `#modal-cancella-account` (`openCancellaAccountModal`, `cancellaAccountCheckMatch`, `cancellaAccountExecute`). Il tab viene inizializzato da `switchConfigSubtab('account')` in `js/configurazioni.js`.
- `js/reset-stagione.js`: aggiunge in fondo al sotto-tab `Stagione` la card "Reset stagione" (wizard 3 step: scelta tipo `mantieni`/`totale` → riepilogo → conferma con digitazione del nome dello stabilimento) e la lista "Backup disponibili" (max 10 FIFO). Bottoni: scarica JSON del backup (download client-side), ripristina (modal con conferma forte + bottone "Scarica clienti attuali (Excel)" via SheetJS riusato dall'import). Tutte le mutazioni passano dalle RPC `crea_backup_stagione` / `reset_stagione` / `ripristina_backup`. **Step 2 del wizard** ha un checkbox "Invia email di chiusura stagione" (default ON): se attivo, prima di chiamare `reset_stagione` la funzione `sendChiusuraStagioneEmails` calcola per ogni cliente registrato (`user_id` non NULL, `email` valorizzata) il riepilogo (gg disponibilità da `disponibilita`, gg sub-affittati da `disponibilita.stato='sub_affittato'`, coin in/out aggregati dalle `transazioni` `credito_ricevuto`/`credito_usato`) e invia il tipo `chiusura_stagione`. Aggregazione client-side via 3 query bulk (clienti, disponibilita, transazioni) per evitare N+1. Le email vanno inviate prima del reset perché disponibilita/transazioni vengono cancellate.
- Pagina cliente stagionale (`#view-stagionale` in `index.html`, logica in `js/stagionale.js`, stili sotto `.stag-view` in `styles.css`): layout mobile-first single-column max 480px (centrato anche su desktop) con header teal self-contained che include logo + bottone "Esci" (`doLogout`). La topnav globale è nascosta sulla view tramite `body.view-stagionale` settata da `showView` in `js/router.js` (questa convenzione vale per qualunque view: il body porta `view-<id>` riflesso dalla view attiva). Body in due tab: "Calendario" (selettore rapido Oggi/Domani/Dopodomani + bottone weekend, "Come funziona" collassabile, calendario, stats giorni liberi/sub-affittati) e "Transazioni". Il selettore rapido e il toggle weekend usano `toggleDay` come il calendario, quindi le modifiche stagiano in `pendingDispChanges` e si committano via `salvaModifichePending` dalla barra "Salva modifiche / Annulla" che appare sotto il calendario quando ci sono modifiche pending. La lista transazioni qui è renderizzata da `renderStagTxList` (categorie `earn`/`spend`/`info`), non dal `renderTxList` del manager.
- Filtro calendario stagionale (`js/stagionale.js → renderCalendar` + `regolaStatoPerData`): i giorni fuori `data_inizio_stagione`/`data_fine_stagione` o coperti da regole sono marcati con la classe `restricted` (CSS in `styles.css`, pattern righe diagonali) e non sono cliccabili. Precedenza: `chiusura_speciale` > `mai_libero` > `sempre_libero`. Banner `#stag-stagione-banner` sopra il calendario mostra il range stagione. Le stesse restrizioni propagano al selettore rapido (bottoni disabilitati con tooltip della regola).
- Banner mappa proprietario (`js/manager.js → renderMapRegoleBanner`, target `#map-regole-banner`): mostra pill "Periodo fuori stagione", "Chiusura speciale attiva", "Sempre/Mai subaffittabile attiva" sopra la mappa quando il range scelto interseca le regole. Caricato a ogni `refreshMap`.
- `js/avanzate.js`: terzo sotto-tab di Configurazioni (`#config-sub-avanzate`). Diviso in due tab interni (`switchAvanzateSubtab` su `.avanzate-subtab` / `.avanzate-pane`):
  - **Azione massiva** (`#avanzate-pane-massiva`, default): mappa interattiva ombrelloni con range date (flatpickr + preset 1/2/3/7 gg / tutta la stagione). Click su un ombrellone apre `#modal-avanzate-omb` (scheda con stato per giorno nel range + bottoni per la singola modifica). Bottoni di massa sopra la mappa: forza disponibili / rimuovi tutte le disponibilità su tutti gli ombrelloni del periodo.
  - **Azione mirata su ombrellone** (`#avanzate-pane-mirata`): selezione di un singolo ombrellone via dropdown, poi visualizzazione inline di scheda cliente + lista giorno-per-giorno della stagione (`#mirata-day-list`, raggruppata per mese con header sticky). Per ogni giorno mostra eventuale regola attiva (`chiusura_speciale`/`mai_libero`/`sempre_libero`) + stato corrente (libero/sub_affittato/occupato) + bottone toggle (Rendi libero / Rimuovi). I sub-affitti già confermati e le `chiusura_speciale` sono read-only (annullamento solo dalla tab Prenotazioni). Bottoni di massa "tutta la stagione" e azioni anagrafica / saldo / cancellazione riusano i flussi esistenti (`openEditRowModal`, `deleteRow`, `modal-avanzate-saldo`).

  Tutte le mutazioni (singole, di massa, mirate) passano da `applyForceDisponibile` / `applyRemoveDisponibilita` (PostgREST con RLS proprietario, niente RPC nuove). La rettifica saldo coin genera una transazione `credito_ricevuto`/`credito_usato` con nota `Rettifica manuale gestore`. Audit log degli INSERT/DELETE è coperto dai trigger `_audit_row_trigger`. Il modal `modal-avanzate-saldo` è condiviso fra i due pane: la variabile `avanzateSaldoOrigin` (`'omb'` | `'mirata'`) traccia da dove è stato aperto per decidere a fine flusso se riaprire la scheda ombrellone o ricaricare la lista mirata.
- `js/comunicazioni.js`: tab top-level "Comunicazioni" (`mtab-comunicazioni`, init `comunicazioniInit()` da `managerTab('comunicazioni')`). Vedi sezione "Comunicazioni (broadcast email)" più sopra per dettagli su selezione destinatari, bozze, throttle invio e audit. Modali dedicati (`modal-comm-anteprima`, `modal-comm-bozza`, `modal-comm-invio`) sono in fondo a `index.html` accanto agli altri overlay. CSS sotto la sezione "COMUNICAZIONI tab" in `styles.css`.
- `js/mappa-builder.js`: visual builder 20×20 per disegnare la mappa degli ombrelloni. Griglia cliccabile con 3 tipi di cella (`ombrellone`, `passerella`, `vuoto`). Wizard 2 step: Step 1 = disegno layout; Step 2 = assegnazione codici. Due modalità di apertura: (a) view dedicata `#view-mappa-builder` via `mostraMappaBuilder()` (usata da `checkOnboardingMappa` in `router.js`); (b) **overlay modale** `#modal-mappa-builder` via `apriMappaBuilderOverlay()` — accessibile dalla card "Gestisci mappa" nel tab Gestione. L'overlay supporta sia creazione (`_mappaModalita='create'`) sia modifica (`_mappaModalita='edit'`): in edit carica la mappa esistente (`_caricaMappaEsistente`), abilita drag-and-drop per spostare ombrelloni, toggle click per aggiungere/rimuovere con conferma per gli ombrelloni DB. Al salvataggio: create → `salvaMappaStabilimento` (credito_giornaliero=1.00); edit → `_onClickSalvaMappa`/`_salvaMappaMod` (update pos, insert nuovi, delete rimossi + cascade clienti/disponibilità). `js/setup.js → saveStabilimento` va direttamente alla dashboard (tab gestione) senza passare per il builder. CSS nella sezione "MAPPA BUILDER" di `styles.css`.

- **03 giu 2026** — FASE 1 backend login email/telefono completata e deployata in prod (PR `feat/login-email-telefono-fase1-backend`). Migration `20260603120000` con RPC `risolvi_login_da_telefono`, `rigenera_invito_token`, trigger normalize phone E.164, unique index parziale. Migration `20260603130000` (hardening post-advisor): `SET search_path = public` sui due helper, `REVOKE EXECUTE ... FROM PUBLIC/anon` su `rigenera_invito_token` (solo `authenticated`), pulizia telefoni `''`→NULL. Edge Function `recupero-password` + estensione `invia-whatsapp` per tipo `recupero_password` (in attesa template Meta, env var `WA_SID_RECUPERO`). Stato e roadmap completi in `LOGIN_TELEFONO.md`. Fase 2 (frontend login/registrazione/recupero) e Fase 3 (manager UI) da implementare. Aggiunto fix sicurezza pre-merge: tipo `recupero_password` riservato a service-role (chiude vettore phishing rilevato in review post-deploy).

- **03 giu 2026** — FASE 2 frontend login email/telefono completata: form login e forgot con campo combinato "email o telefono" (id rinominati `login-email`→`login-identifier`, `forgot-email`→`forgot-identifier`; aggiornato anche il prefill `?login=` in `js/main.js` e lo script `scripts/login-4accounts.js`), pagina invito con telefono sempre visibile ("(non impostato)" se manca), `completeInviteRegistration` genera email sintetica `<numero>@phone.spiaggiamia.it` per clienti senza email reale e salta l'email di benvenuto in quel caso. Nuovi helper `isEmailLike`/`emailSinteticaDaTelefono` in `js/utils.js`. `doLogin` disambigua email/telefono e usa RPC `risolvi_login_da_telefono`; `doForgotPassword` sceglie canale email (Supabase native) vs telefono (Edge Function `recupero-password`). PR `feat/login-email-telefono-fase2-frontend`. Da fare: Fase 3 (manager UI con menu ⋮ per riga cliente + bulk action estesa).

- **03 giu 2026** — HOTFIX post Fase 2 login email/telefono:
  (a) CORS uniformato su invia-whatsapp e invia-email (helper
      jsonResponse, Allow-Origin in tutte le response). Risolve
      errori "Failed to fetch" da https://www.spiaggiamia.com.
  (b) completeInviteRegistration in js/auth.js ora destruttura
      { error } su profiles.insert e completa_registrazione_invito,
      fa rollback (delete profile, unblock_invito_email, signOut)
      e mostra alert se uno step fallisce. Niente piu' dashboard
      rotta silenziosa.
  (c) confirmBulkInvite e confirmImportaExcelExecute in js/clienti.js
      ora gestiscono multi-canale: tentano email (se presente) +
      WA (se applicabile) per ogni cliente, e contano "inviato" se
      almeno UNO funziona. Sblocca l'invio WhatsApp per clienti
      senza email (Andrea Lombardi e simili). inviaWhatsapp in
      js/utils.js ritorna ora { ok, skipped?, error? } per
      permettere ai chiamanti di leggere il risultato.

- **03 giu 2026** — FIX C — chiusura open relay invia-email:
  - supabase/config.toml: verify_jwt = true (era false)
  - supabase/functions/invia-email/index.ts: aggiunto check JWT
    pattern identico a invia-whatsapp (accetta utenti autenticati OR
    service-role-key per chiamate server-to-server)
  - chiude vettore di spam/phishing che impersonava spiaggiamia.com
    tramite chiamate non autenticate a Resend via la function
  - nessuna regressione attesa: tutte le 9 invocazioni client di
    inviaEmail() passano gia' Authorization Bearer quando l'utente
    ha una sessione (verificato)

- **03 giu 2026** — FASE 3 — Manager UI completa:
  (a) Backend: nuova Edge Function `richiedi-reset-cliente`
      (manager-driven reset password con ownership check +
      `generateLink` Admin API). Nuovo tipo `reset_password` in
      `invia-email` con template branded (campo `recovery_link`).
      Deploy in prod: `invia-email` v103, `richiedi-reset-cliente`
      v1 (entrambe verify_jwt=true).
  (b) Frontend: menu ⋮ popover contestuale per cliente nella
      tabella Gestione (`manager.js openClienteActionMenu`). Azioni
      dinamiche per stato cliente. Bulk modale esteso per selezione
      mista (clienti registrati + non-registrati) con auto-split
      invito/reset (`js/clienti.js`). Helper `richiediResetCliente`
      in `js/utils.js`. CSS `.cliente-action-popover` in `styles.css`.
  (c) Niente migrations SQL. Riusa RPC `rigenera_invito_token`
      (Fase 1). Vedi `LOGIN_TELEFONO.md` per il design completo.

## Mantenimento di questo file

Quando una sessione introduce un cambiamento **strutturale** — nuova tabella, nuova colonna/FK rilevante, nuova RPC, nuova Edge Function, nuovo env var, nuova convenzione, cambio di workflow git — **aggiorna `CLAUDE.md` nella stessa sessione** (preferibilmente nello stesso commit del cambiamento).

Un hook `Stop` in `.claude/settings.json` (→ `.claude/claude-md-reminder.sh`) controlla l'ultimo commit e il working tree: se `supabase/migrations/` o `supabase/functions/` cambiano senza che `CLAUDE.md` sia toccato, emette un reminder al termine del turno.
