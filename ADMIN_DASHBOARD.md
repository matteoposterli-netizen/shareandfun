# Admin — Dashboard Admin di piattaforma

## Obiettivo

Pagina admin standalone (`admin.html`) che offre una vista d'insieme di piattaforma su
**tutti** gli stabilimenti di SpiaggiaMia. Nasce per superare i limiti
degli strumenti admin esistenti — la vecchia CRUD grezza `?admin=1` (`js/admin.js`,
ora integrata come tab "Tabelle" di questa pagina) e "Log attività" (`js/audit.js`,
per-stabilimento lato proprietario) — dando all'operatore di sistema numeri aggregati
cross-tenant e, nelle fasi successive, strumenti operativi (log cross-tenant,
impersonazione, log tecnici, approvazioni).

## Roadmap (5 fasi)

1. **Dashboard base** — vista sola lettura: KPI di piattaforma + tabella stabilimenti + tab "Tabelle" (CRUD grezzo, ex `?admin=1`). ✅
2. **Log cross-tenant** — audit + WhatsApp unificati su tutti gli stabilimenti (tab "📋 Log", toggle Audit/WhatsApp). ✅ **Nessuna migration aggiuntiva in questa fase**: la policy `audit_log_select_admin` (in `20260424500000_audit_log.sql`) concede già agli admin SELECT su tutto l'`audit_log`; per `wa_messages_log` la policy `wa_messages_log_select_admin` (sola lettura) è stata aggiunta con una migration dedicata, già applicata in prod.
3. **Impersonazione proprietario** — pulsante "Entra come proprietario" per operare nel contesto di uno stabilimento. 🟡 **codice pronto, in attesa di deploy Edge Function `admin-impersona-proprietario` da parte di Matteo/Claude** (vedi sezione "Fase 3" più sotto).
4. **Log tecnici** — visibilità su log Edge Function / Vercel.
5. **Approvazione creazione stabilimenti** — flusso di review/approvazione dei nuovi stabilimenti.

## Stato attuale

- **Fase 1: completata** (mergiata in `main` / prod). **Fase 2 (Log cross-tenant, tab "📋 Log" con toggle Audit + WhatsApp): completata** (in attesa di preview Vercel + conferma). `audit_log_select_admin` esisteva già; `wa_messages_log_select_admin` (sola lettura) aggiunta con migration dedicata — nessun'altra migration necessaria per questa fase.
- File: `admin.html` nella root (stack identico a `devboard.html`: React 18 + Babel standalone via CDN, supabase-js v2, nessun build step, tutto in un unico HTML).
- `<meta name="robots" content="noindex, nofollow">`. Non linkata da nessuna nav esistente.
- La vecchia modalità `?admin=1` di `index.html` è stata ritirata: ora `index.html?admin=1` fa `window.location.replace('/admin.html')` e `js/admin.js` è stato eliminato (logica portata nel tab "Tabelle").
- Nessuna migration DB in questa fase (Panoramica/Stabilimenti sono sola lettura; il tab "Tabelle" scrive via RLS admin come faceva `js/admin.js`).

## Struttura pagina (Fase 1)

- **Gate di autenticazione**: form email+password (email prefillata con `matteo.posterli+admin@gmail.com` — corretta in Fase 2 da un refuso di Fase 1 che prefillava l'email primaria) → `signInWithPassword` → verifica presenza in `public.admins` (`select user_id ... maybeSingle()`); se assente → `signOut()` + "Accesso non autorizzato". `getSession()` all'avvio per non richiedere login a ogni refresh.
- **Tab Panoramica**: KPI card (totale stabilimenti, proprietari, stagionali, credito totale in circolazione, WhatsApp attivo X/Y, ombrelloni attivi/totali, clienti in attesa di approvazione, clienti totali).
- **Tab Stabilimenti**: tabella una riga per stabilimento (nome+città, proprietario, creato il, ombrelloni attivi/totali, clienti approvati/attesa/rifiutati/totali, credito, badge WhatsApp, date stagione) + search testuale su nome/città + riga espandibile con il dettaglio. Pulsante "Entra come proprietario" presente ma **disabilitato** con tooltip "Prossimamente" (predisposizione Fase 3).
- **Tab Tabelle** (🗄️): CRUD grezzo tabella-per-tabella, portato fedelmente da `js/admin.js`. Selettore sulle 6 tabelle business (`profiles`, `stabilimenti`, `ombrelloni`, `clienti_stagionali`, `disponibilita`, `transazioni`); a differenza di Panoramica/Stabilimenti carica **solo** la tabella selezionata al cambio (order by + `limit 1000`, `disponibilita`/`transazioni` possono avere molte righe); ricerca testuale client-side sulle colonne di lista; form generico add/modifica pilotato dalla definizione campi (`ADMIN_TABLES`: type text/textarea/select/bool/number/date + required/readonly/options/help/step); eliminazione riga con conferma. Riusa lo stesso client `sb` e le stesse RLS admin (coprono tutte e 6 le tabelle via `admin_section.sql`). Componenti React `Tabelle` + `RowEditor`, stile inline coerente col resto della pagina.
- **Tab Log** (📋): wrapper con **toggle a due voci — Audit (default) e WhatsApp** (componente React `Log`). Entrambe le sotto-viste sono cross-tenant via RLS admin.
  - **Sotto-vista Audit** (`LogAudit`): audit cross-tenant su `public.audit_log`, versione admin del "Log attività" per-proprietario (`js/audit.js`). Legge via policy `audit_log_select_admin` (accesso a TUTTI gli stabilimenti). Filtri: stabilimento (dropdown), range date (default ultimi 7 gg), tipo attore, entità, azione, testo libero (`description`/`actor_label` ILIKE). Paginazione server-side (`range` + `count: exact`, `created_at DESC`, page size 30/50/100). Colonna "Coinvolto" (ombrellone/cliente) e nome stabilimento risolti dalle anagrafiche globali già caricate dal dashboard (`data.stabilimenti`/`ombrelloni`/`clienti`) — niente fetch extra. Righe espandibili con `diff`/`before`/`after` JSON (`JsonBlock`). Export Excel dei match filtrati (SheetJS, chunk da 1000, cap 50k). Rispetto alla versione manager sono stati omessi i filtri per nome/cognome/email/n° ombrellone risolti in liste di id (evitano `IN()` giganti cross-tenant); il resto è equivalente. **Aggiunta dipendenza CDN**: SheetJS (`xlsx.full.min.js`) nel `<head>` per l'export.
  - **Sotto-vista WhatsApp** (`LogWhatsapp`): log dei messaggi WhatsApp su `public.wa_messages_log`, cross-tenant via policy `wa_messages_log_select_admin` (sola lettura). Fetch semplice `select('*').order('created_at' desc).limit(1000)` (volume oggi contenuto, niente paginazione avanzata). Filtri client-side: stabilimento (dropdown) + stato (opzioni derivate dai valori effettivamente presenti nei dati, nessun enum hardcoded). Colonne: Data, Stabilimento (nome risolto da `data.stabilimenti`), Destinatario (`to_number`), Tipo (etichette `WA_TIPO_LABELS`), Stato (badge colorato dedotto dal valore via `waStatusStyle`: verde per delivered/read/sent, rosso per failed/undelivered, grigio per gli altri), Errore (`error_code` · `error_message` se presenti).
- Panoramica/Stabilimenti fanno fetch completo delle tabelle (`.select('*').limit(1000)`) e aggregazione lato client, stesso approccio di com'era `js/admin.js`. Scala attuale: ~4 stabilimenti, poche decine di righe.

## Panoramica cliccabile + tab di dettaglio

La barra tab ha **8 voci** (il `flex-wrap` dell'`Header` gestisce l'overflow su mobile):
`panoramica`, `stabilimenti`, `proprietari` (👤), `stagionali` (🧑), `clienti` (🎫),
`ombrelloni` (⛱️), `tabelle`, `log`. Tutti i tab sono raggiungibili anche direttamente
dalla barra, senza passare dalla Panoramica.

**Nessuna query Supabase aggiuntiva e nessuna migration**: i 4 nuovi tab aggregano lato
client i dati già caricati da `loadAll()` in `data.{stabilimenti, profiles, ombrelloni,
clienti}`.

### Meccanismo di navigazione (`goTo` / `navPreset`)

`AdminDashboard` mantiene `const [navPreset, setNavPreset] = useState(null)` e una
funzione `goTo(tabId, preset)` che imposta il preset e cambia tab. `goTo` è passata a
`<Panoramica onNavigate={goTo}>`. I due soli tab che ricevono un preset dalle card —
`Stabilimenti` e `Clienti` — ricevono anche `navPreset` + `onPresetConsumed={() =>
setNavPreset(null)}` e lo consumano al mount/aggiornamento con un `useEffect` che applica
i filtri e poi chiama `onPresetConsumed()`. Il preset **preimposta** i filtri ma resta
sempre modificabile a mano dall'utente.

### KpiCard cliccabile

`KpiCard` accetta una prop opzionale `onClick`: se presente, il contenitore diventa
`cursor: pointer` con un effetto hover (boxShadow più marcato + bordo `#7dd3fc` +
leggero `translateY`). Senza `onClick` la card resta statica come prima.

### Mappatura KPI card → destinazione

| Card Panoramica | Destinazione (`goTo`) |
|---|---|
| Stabilimenti | `stabilimenti` `{ stato: "tutti", wa: "tutti" }` |
| Stabilimenti in attesa | `stabilimenti` `{ stato: "attesa" }` |
| Proprietari | `proprietari` |
| Stagionali | `stagionali` |
| Credito in circolazione | `clienti` `{ stato: "tutti", sort: "credito_desc" }` |
| WhatsApp attivo | `stabilimenti` `{ wa: "attivo" }` |
| Ombrelloni | `ombrelloni` |
| Clienti in attesa | `clienti` `{ stato: "attesa" }` |
| Clienti stagionali | `clienti` `{ stato: "tutti" }` |

### Tab Stabilimenti — filtri aggiuntivi

Oltre alla search testuale su nome/città, due `<select>` combinati in AND (stessa
`useMemo`): **Stato** (Tutti / 🟡 In attesa `!approvato && !rifiutato` / 🟢 Approvato
`approvato && !rifiutato` / 🔴 Rifiutato `rifiutato`) e **WhatsApp** (Tutti / Attivo /
Non attivo → `wa_enabled`). Consuma `navPreset` (campi `stato` / `wa`). Le azioni
preesistenti (`StabStatoCell` Approva/Rifiuta, riga espandibile, "Entra come
proprietario") sono invariate.

### Tab Proprietari (`profiles.ruolo === "proprietario"`)

Colonne: Nome Cognome | Email | Telefono | Stabilimento/i | Creato il. Lo/gli
stabilimento/i sono risolti da `data.stabilimenti` dove `proprietario_id === profilo.id`
(può essercene più d'uno → nomi separati da virgola; "—" se nessuno). Solo search
testuale (nome/cognome/email/telefono/stabilimento risolto), nessun dropdown.

### Tab Stagionali (`profiles.ruolo === "stagionale"`)

Colonne: Nome Cognome | Email | Telefono | Stabilimento | Creato il. Lo stabilimento è
risolto via `data.clienti` dove `user_id === profilo.id` → `stabilimento_id` → nome (se
più record collegati si prende il primo, senza bloccare il rendering). Filtri: search
testuale (nome/cognome/email/telefono) + dropdown Stabilimento.

### Tab Clienti (`data.clienti`, cross-tenant — `clienti_stagionali`)

Colonne: Nome Cognome | Stabilimento | Telefono/Email | Credito saldo | Stato (badge
🟡/🟢/🔴 **sola lettura**, nessuna azione approva/rifiuta) | Ombrellone (codice risolto
da `data.ombrelloni` via `ombrellone_id`, "—" se null) | Registrato (Sì se `user_id`
presente) | Creato il. Filtri: dropdown Stabilimento, dropdown Stato (Tutti / In attesa
/ Approvato / Rifiutato), search testuale (nome/cognome/telefono/email), dropdown Ordina
per (Data creazione `created_at desc` default / Credito decrescente / Nome A-Z). Consuma
`navPreset` (campi `stato` + `sort`).

### Tab Ombrelloni (`data.ombrelloni`, cross-tenant)

Colonne: Codice | Stabilimento | Posizione (`pos_x, pos_y`) | Credito giornaliero |
Stato (badge `S.badgeOn`/`S.badgeOff` da `attivo`) | Creato il. Filtri: dropdown
Stabilimento, dropdown Stato (Tutti / Attivo / Non attivo), search testuale sul codice.

## Decisioni prese

- **Account admin per il login**: il campo email del gate è prefillato con `matteo.posterli+admin@gmail.com` (admin dal 2026-04-24; in Fase 2 corretto il refuso di Fase 1 che prefillava l'email primaria). Sono comunque admin **due** account: `matteo.posterli+admin@gmail.com` e l'email primaria `matteo.posterli@gmail.com`. Quest'ultima è stata **aggiunta a `public.admins`** il 2026-07-19 (`INSERT INTO public.admins (user_id) VALUES ('b6bea9e9-71b3-493b-9fe2-d1b79b336e1b')`) per poter usare anche l'email primaria come login di Regia; senza quella riga vedrebbe query RLS vuote. L'email primaria è un account con anche `ruolo='proprietario'` in `profiles` (deroga alla convenzione "admin senza profilo", ma funzionalmente ok: `is_admin()` controlla solo `public.admins`). L'autorizzazione passa da `public.admins` + `public.is_admin(uid)` (migration `20260424000000_admin_section.sql`).
- **Colonna `email` su `profiles`**: in produzione `profiles.email` **esiste** (text nullable) ed è leggibile lato client via RLS admin. È usata nei tab **Proprietari** e **Stagionali** (colonna Email). Nota storica: in Fase 1/2 era considerata assente e non veniva mostrata; da questa fase è esposta.
- **RLS admin già pronta** su `profiles`, `stabilimenti`, `ombrelloni`, `clienti_stagionali` (SELECT coperto). Per il tab Log: `audit_log_select_admin` esisteva già (`20260424500000_audit_log.sql`); `wa_messages_log_select_admin` (sola lettura) aggiunta con migration dedicata, già applicata in prod. Nessun'altra migration necessaria per la Fase 2.
- Config Supabase (`SUPABASE_URL`, publishable `SUPABASE_KEY`) copiata da `devboard.html`.
- Colonne usate (verificate in produzione):
  - `stabilimenti`: id, nome, citta, proprietario_id, created_at, wa_enabled, approvato, rifiutato, data_inizio_stagione, data_fine_stagione, nome_credito
  - `profiles`: id, nome, cognome, telefono, ruolo, email, created_at
  - `ombrelloni`: id, stabilimento_id, codice, pos_x, pos_y, attivo, credito_giornaliero, created_at
  - `clienti_stagionali`: id, stabilimento_id, ombrellone_id, user_id, nome, cognome, email, telefono, credito_saldo, approvato, rifiutato, created_at

## Fase 3 — Impersonazione proprietario (codice pronto, in attesa di deploy)

**Stato**: codice pronto sul branch, **in attesa di deploy della Edge Function `admin-impersona-proprietario` da parte di Matteo/Claude** (via Supabase MCP). Il merge della PR aspetta il deploy perché il flusso non è testabile finché la function non è live. Nessuna migration necessaria (l'audit log usa valori già ammessi dai CHECK constraint).

**Cosa fa**: attiva il pulsante "Entra come proprietario" nel tab Stabilimenti (riga espandibile). Al click:
1. Conferma esplicita (`window.confirm`) con nome proprietario + stabilimento.
2. `sb.functions.invoke('admin-impersona-proprietario', { body: { stabilimento_id, redirect_origin: location.origin } })`.
3. La Edge Function (service-role) verifica che il chiamante sia in `public.admins` (403 altrimenti), risolve `proprietario_id` dello stabilimento (404 se assente), recupera l'email del proprietario via `auth.admin.getUserById`, genera un magic link `generateLink({ type: 'magiclink', redirectTo: '<redirect_origin>/index.html?impersonated=1' })`, logga un evento in `audit_log` (`actor_type='admin'`, `actor_label`=email admin, `entity_type='auth'`, `action='login'`, `stabilimento_id` target) e ritorna `{ ok: true, link }`.
4. Il client apre il link con `window.open(link, '_blank')` — **nuova scheda**, così la scheda admin resta autenticata come admin.

`redirect_origin` è calcolato lato client da `location.origin` (NON hardcodato), così la function funziona identica su preview Vercel e in produzione.

**Config**: `[functions.admin-impersona-proprietario] verify_jwt = true` in `config.toml` (richiede sessione admin valida; il JWT inviato è l'access_token della sessione admin, un JWT firmato che supera il gate).

**Banner lato impersonato** (`js/main.js`): all'avvio, se l'URL contiene `?impersonated=1` E la sessione si stabilisce, viene settato il flag `sessionStorage['sm_admin_impersonation']` (JSON con nome/email proprietario), il query param viene ripulito via `history.replaceState` (preservando l'hash con i token magic link), e viene mostrato un banner fisso in basso (scuro/arancione, `#impersonation-banner` in `styles.css`) "🔐 Modalità admin — stai operando come [proprietario]" con pulsante "Esci da questa sessione" (`exitImpersonation`: `signOut` + `window.close()`, con fallback a un messaggio se il browser rifiuta la chiusura programmatica della scheda).

**Limite noto — persistenza sessione**: supabase-js persiste la sessione in `localStorage`, **condiviso per origine tra tutte le schede** dello stesso browser, e sincronizza lo stato auth via `storage` event. Se l'admin ha già un'altra scheda aperta su `spiaggiamia.com` con una sessione diversa, può esserci interferenza tra schede (la sessione impersonata può propagarsi/sovrascrivere). Il flag `sm_admin_impersonation` è invece in `sessionStorage` (isolato per scheda) e serve solo a mostrare il banner nella scheda corretta. Mitigazione in Fase 3: banner molto visibile + pulsante "Esci" facilmente raggiungibile, per ridurre il tempo in cui la sessione impersonata resta attiva. Non è previsto codice difensivo più sofisticato (es. storage isolato per scheda) in questa fase.

## Fase 5 — Approvazione creazione stabilimenti (codice pronto, in attesa di deploy)

**Stato**: codice completo sul branch. Migration **già applicata in prod** (via Supabase MCP): `stabilimenti.approvato` (boolean NOT NULL DEFAULT false) + `stabilimenti.rifiutato` (boolean NOT NULL DEFAULT false); i 2 stabilimenti preesistenti backfillati `approvato=true`. Da ora ogni nuovo stabilimento nasce `approvato=false, rifiutato=false` e resta "in attesa" finché un admin non lo approva/rifiuta da `admin.html`. **In attesa del deploy** della nuova Edge Function `notifica-nuovo-stabilimento` e del redeploy di `invia-email` (3 nuovi tipi) prima del test end-to-end.

**Gate lato proprietario** (2 punti):
1. `js/setup.js → saveStabilimento()`: dopo l'insert riuscito NON entra nel manager, ma mostra la view `in-attesa`. Lancia in fire-and-forget (non bloccanti): (a) email `stabilimento_in_attesa` al proprietario via `inviaEmail`, (b) notifica admin via `sb.functions.invoke('notifica-nuovo-stabilimento', …)`.
2. `js/router.js → loadUserAndRoute()` (ramo proprietario, dopo `currentStabilimento = stab`): `if (stab.rifiutato) showView('rifiutato')`; `else if (!stab.approvato) showView('in-attesa')`; altrimenti prosegue come prima (onboarding mappa → manager).

**Nuove view statiche** (`index.html`, stile `setup-container`): `#view-in-attesa` ("Richiesta in revisione" + logout) e `#view-rifiutato` ("Richiesta non approvata" + contatto `[EMAIL SUPPORTO]` placeholder da sostituire + logout).

**Gate lato admin** (`admin.html`):
- Tab **Panoramica**: nuova KPI card "Stabilimenti in attesa" (`stabInAttesa` in `computeStats`, count `!approvato && !rifiutato` — nessuna query aggiuntiva).
- Tab **Stabilimenti**: nuova colonna "Stato" con badge 🟡 In attesa / 🟢 Approvato / 🔴 Rifiutato (componente `StabStatoCell`). Per le righe 🟡, bottoni "✅ Approva" / "❌ Rifiuta" con conferma esplicita (nome proprietario + stabilimento). Al click: `sb.from('stabilimenti').update({approvato/rifiutato}).eq('id', …)` (RLS admin), patch locale `AdminDashboard.patchStab` (aggiorna badge **e** KPI, entrambi derivati da `data.stabilimenti`), + email di esito fire-and-forget (`stabilimento_approvato`/`stabilimento_rifiutato`). L'audit è coperto dal trigger su UPDATE stabilimenti.

**3 nuovi tipi email** in `invia-email` (contenuto FISSO di piattaforma, NON personalizzabile per stabilimento): `stabilimento_in_attesa`, `stabilimento_approvato`, `stabilimento_rifiutato`. Destinatario = email del **proprietario** (da `auth.users`, non `stabilimenti.email`). Poiché `profiles` non ha colonna email e `admin.html` non può leggere `auth.users` lato client, questi tipi accettano `proprietario_id` e risolvono l'email destinataria (+ costruiscono `login_link = APP_URL + '/?login=' + email` per il tipo approvato) **server-side** via `auth.admin.getUserById`. `setup.js` passa invece direttamente `email` (= `currentUser.email`). Nuova env opzionale `APP_URL` (default `https://spiaggiamia.com`).

**Nuova Edge Function `notifica-nuovo-stabilimento`** (`verify_jwt=true` in `config.toml`; chiamante sempre autenticato = proprietario appena registrato). Input `{ stabilimento_nome, citta, proprietario_nome, proprietario_cognome, proprietario_email }`. Fa due cose indipendenti via `Promise.allSettled` (un fallimento non blocca l'altro, mai propagato al chiamante): (1) email a `matteo.posterli@gmail.com` via Resend (stesso provider di `invia-email`, chiamata diretta all'API Resend) con nome/città stabilimento + dati proprietario + link `https://spiaggiamia.com/admin.html`; (2) messaggio Telegram via `POST https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`. **Secret Telegram richiesti** (da impostare su Supabase prima del deploy): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` — se uno manca a runtime il canale Telegram viene saltato silenziosamente (log + skip), senza rompere la registrazione. Riusa anche `RESEND_API_KEY`/`FROM_EMAIL` già configurate.

**DA FARE A MANO prima del test end-to-end**: (a) deploy `notifica-nuovo-stabilimento`; (b) redeploy `invia-email` (3 nuovi tipi + risoluzione `proprietario_id`); (c) impostare i secret `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID` (+ opzionale `APP_URL`); (d) sostituire il placeholder `[EMAIL SUPPORTO]` nella view `#view-rifiutato`.

## Note operative

- Non mergiare su `main`: attendere preview Vercel del branch + conferma.
- Non c'è build step / `node --check`: JSX transpilato a runtime da Babel standalone (come `devboard.html`).
- **Fase 3**: prima del merge serve il deploy della Edge Function `admin-impersona-proprietario` (Supabase MCP, previa conferma). Il codice della function è in `supabase/functions/admin-impersona-proprietario/index.ts`.
- **Fase 5**: prima del test end-to-end serve il deploy di `notifica-nuovo-stabilimento` + redeploy di `invia-email`, e i secret Telegram. Vedi sezione "Fase 5" sopra.
