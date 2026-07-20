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
3. **Impersonazione proprietario** — pulsante "Entra come proprietario" per operare nel contesto di uno stabilimento.
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

## Decisioni prese

- **Account admin per il login**: il campo email del gate è prefillato con `matteo.posterli+admin@gmail.com` (admin dal 2026-04-24; in Fase 2 corretto il refuso di Fase 1 che prefillava l'email primaria). Sono comunque admin **due** account: `matteo.posterli+admin@gmail.com` e l'email primaria `matteo.posterli@gmail.com`. Quest'ultima è stata **aggiunta a `public.admins`** il 2026-07-19 (`INSERT INTO public.admins (user_id) VALUES ('b6bea9e9-71b3-493b-9fe2-d1b79b336e1b')`) per poter usare anche l'email primaria come login di Regia; senza quella riga vedrebbe query RLS vuote. L'email primaria è un account con anche `ruolo='proprietario'` in `profiles` (deroga alla convenzione "admin senza profilo", ma funzionalmente ok: `is_admin()` controlla solo `public.admins`). L'autorizzazione passa da `public.admins` + `public.is_admin(uid)` (migration `20260424000000_admin_section.sql`).
- **Niente colonna `email` su `profiles`** — non disponibile lato client, non mostrata.
- **RLS admin già pronta** su `profiles`, `stabilimenti`, `ombrelloni`, `clienti_stagionali` (SELECT coperto). Per il tab Log: `audit_log_select_admin` esisteva già (`20260424500000_audit_log.sql`); `wa_messages_log_select_admin` (sola lettura) aggiunta con migration dedicata, già applicata in prod. Nessun'altra migration necessaria per la Fase 2.
- Config Supabase (`SUPABASE_URL`, publishable `SUPABASE_KEY`) copiata da `devboard.html`.
- Colonne usate (verificate in produzione):
  - `stabilimenti`: id, nome, citta, proprietario_id, created_at, wa_enabled, data_inizio_stagione, data_fine_stagione, nome_credito
  - `profiles`: id, nome, cognome, telefono, ruolo (nessuna email)
  - `ombrelloni`: id, stabilimento_id, codice, attivo, credito_giornaliero
  - `clienti_stagionali`: id, stabilimento_id, credito_saldo, approvato, rifiutato

## Note operative

- Non mergiare su `main`: attendere preview Vercel del branch + conferma.
- Non c'è build step / `node --check`: JSX transpilato a runtime da Babel standalone (come `devboard.html`).
