# Snippet da integrare in CLAUDE.md

## Aggiungi alla sezione "Schema (public)"

Nella tabella `stabilimenti`, riga descrittiva, aggiungi dopo "Template email personalizzabili: ...":

```
Contabilità: `citta` (nullable) usato come breadcrumb nella Panoramica manager.
```

Nella tabella `transazioni`, aggiungi dopo lo scopo:

```
Colonna opzionale `categoria` (bar|ristorante|altro, CHECK) popolata solo per `tipo=credito_usato` — serve al pie chart "Dove spendono" della Panoramica deep dive. NULL per tutti gli altri tipi.
```

## Aggiungi alla sezione "Stack"

Dopo la riga dei file JS citati (auth, manager, clienti, audit…), aggiungi:

```
- `js/panoramica.js` + `js/dd-common.js` — Panoramica manager con 4 KPI cliccabili (disponibilità dichiarate, prenotazioni, coin distribuiti, coin spesi), toolbar periodo unificata (7/30/90 gg, Stagione, custom), flow diagram e top 3 ombrelloni. Router verso 4 deep dive (al momento placeholder; dettagli in Consegna 2).
```

## Aggiungi alla sezione "Note operative"

```
- La tab Panoramica è guidata da `panoramicaInit()` — invocata da `managerTab('panoramica')`. Riusa `ombrelloniList`/`clientiList`/`currentStabilimento` già caricati da `loadManagerData`. Non dipende da `loadDashboardUpcomingKpis`/`loadDashboardCreditsKpis` (che restano come fallback se il nuovo HTML non è deployato).
- `js/dd-common.js`: helpers per date range, delta %, sparkline SVG, export Excel. Shared con la tab Panoramica e i futuri deep dive.
```

## (Opzionale) Nuova sezione "Migrations cronologia"

Se vuoi, puoi aggiungere in fondo al file un elenco delle migration applicate, per comodità operativa:

```
## Migrations applicate

| File | Data | Note |
|---|---|---|
| 20260420000000_baseline.sql | 2026-04-20 | Schema iniziale |
| 20260424500000_audit_log.sql | 2026-04-24 | Audit log + pg_cron retention |
| 20260424900000_stagione.sql | 2026-04-24 | data_inizio/fine_stagione + chiusure_eccezionali |
| 20260425000000_panoramica_deepdive.sql | 2026-04-25 | citta (stabilimenti), categoria (transazioni), idx transazioni KPI |
```
