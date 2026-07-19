# Regia — Dashboard Admin di piattaforma

## Obiettivo

Pagina admin standalone (`regia.html`) che offre una vista d'insieme "di regia" su
**tutti** gli stabilimenti della piattaforma SpiaggiaMia. Nasce per superare i limiti
degli strumenti admin esistenti — `?admin=1` (CRUD grezzo tabella-per-tabella,
`js/admin.js`) e "Log attività" (`js/audit.js`, per-stabilimento lato proprietario) —
dando all'operatore di sistema numeri aggregati cross-tenant e, nelle fasi successive,
strumenti operativi (log cross-tenant, impersonazione, log tecnici, approvazioni).

## Roadmap (5 fasi)

1. **Dashboard base** — vista sola lettura: KPI di piattaforma + tabella stabilimenti. *(questa fase)*
2. **Log cross-tenant** — audit unificato su tutti gli stabilimenti (richiede migration RLS su `audit_log` / `wa_messages_log`).
3. **Impersonazione proprietario** — pulsante "Entra come proprietario" per operare nel contesto di uno stabilimento.
4. **Log tecnici** — visibilità su log Edge Function / Vercel.
5. **Approvazione creazione stabilimenti** — flusso di review/approvazione dei nuovi stabilimenti.

## Stato attuale

- **Fase 1: in corso** (implementazione iniziale completata, in attesa di preview Vercel + conferma).
- File: `regia.html` nella root (stack identico a `devboard.html`: React 18 + Babel standalone via CDN, supabase-js v2, nessun build step, tutto in un unico HTML).
- `<meta name="robots" content="noindex, nofollow">`. Non linkata da nessuna nav esistente.
- Nessuna migration DB in questa fase (sola lettura).

## Struttura pagina (Fase 1)

- **Gate di autenticazione**: form email+password (email prefillata con `matteo.posterli@gmail.com`) → `signInWithPassword` → verifica presenza in `public.admins` (`select user_id ... maybeSingle()`); se assente → `signOut()` + "Accesso non autorizzato". `getSession()` all'avvio per non richiedere login a ogni refresh.
- **Tab Panoramica**: KPI card (totale stabilimenti, proprietari, stagionali, credito totale in circolazione, WhatsApp attivo X/Y, ombrelloni attivi/totali, clienti in attesa di approvazione, clienti totali).
- **Tab Stabilimenti**: tabella una riga per stabilimento (nome+città, proprietario, creato il, ombrelloni attivi/totali, clienti approvati/attesa/rifiutati/totali, credito, badge WhatsApp, date stagione) + search testuale su nome/città + riga espandibile con il dettaglio. Pulsante "Entra come proprietario" presente ma **disabilitato** con tooltip "Prossimamente" (predisposizione Fase 3).
- Fetch completo delle tabelle (`.select('*').limit(1000)`) e aggregazione lato client, stesso approccio di `js/admin.js`. Scala attuale: ~4 stabilimenti, poche decine di righe.

## Decisioni prese

- **Account admin per il login = `matteo.posterli@gmail.com`** (prefillato nel campo email del gate). Questo account è stato **aggiunto a `public.admins`** il 2026-07-19 (`INSERT INTO public.admins (user_id) VALUES ('b6bea9e9-71b3-493b-9fe2-d1b79b336e1b')`) proprio per poter usare l'email primaria come login di Regia; senza quella riga vedrebbe query RLS vuote. È un account con anche `ruolo='proprietario'` in `profiles` (deroga alla convenzione "admin senza profilo", ma funzionalmente ok: `is_admin()` controlla solo `public.admins`). Resta valido anche `matteo.posterli+admin@gmail.com` (admin dal 2026-04-24). L'autorizzazione passa da `public.admins` + `public.is_admin(uid)` (migration `20260424000000_admin_section.sql`).
- **Niente colonna `email` su `profiles`** — non disponibile lato client, non mostrata.
- **RLS admin già pronta** su `profiles`, `stabilimenti`, `ombrelloni`, `clienti_stagionali` (SELECT coperto). **NON** su `audit_log` / `wa_messages_log`: quelli arrivano in Fase 2 con migration dedicata — non toccati in Fase 1.
- Config Supabase (`SUPABASE_URL`, publishable `SUPABASE_KEY`) copiata da `devboard.html`.
- Colonne usate (verificate in produzione):
  - `stabilimenti`: id, nome, citta, proprietario_id, created_at, wa_enabled, data_inizio_stagione, data_fine_stagione, nome_credito
  - `profiles`: id, nome, cognome, telefono, ruolo (nessuna email)
  - `ombrelloni`: id, stabilimento_id, codice, attivo, credito_giornaliero
  - `clienti_stagionali`: id, stabilimento_id, credito_saldo, approvato, rifiutato

## Note operative

- Branch di sviluppo previsto per la feature: `feature/regia-admin-dashboard`. Non mergiare su `main`: attendere preview Vercel del branch + conferma.
- Non c'è build step / `node --check`: JSX transpilato a runtime da Babel standalone (come `devboard.html`).
