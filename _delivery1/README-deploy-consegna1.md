# Consegna 1 — Panoramica manager SpiaggiaMia

Redesign della tab "Panoramica" del gestore con:

- **Toolbar periodo unificata**: 4 preset (7gg / 30gg / 90gg / Stagione) + range custom + toggle confronto
- **4 KPI card cliccabili** con sparkline e delta vs periodo precedente:
  1. Disponibilità dichiarate (notti libero + sub-affittato)
  2. Prenotazioni effettuate (notti sub-affittate)
  3. {Nome}Coin distribuiti (somma `credito_ricevuto`)
  4. {Nome}Coin spesi (somma `credito_usato`)
- **Flow diagram** disp → pren → distr → spent con tassi di conversione
- **Top 3 ombrelloni** più prenotati del periodo
- **Router deep-dive**: click su un KPI apre un pannello dedicato (Consegna 1 espone solo placeholder + toolbar + export stub; contenuto ricco in Consegna 2)

Layout responsive (desktop/tablet/mobile). Stile minimal scandinavo coerente con il redesign esistente.

---

## Pacchetto

```
deploy-consegna1/
├── README-deploy-consegna1.md          ← questo file
├── supabase/migrations/
│   └── 20260425000000_panoramica_deepdive.sql
├── js/
│   ├── dd-common.js                    ← NUOVO (helpers)
│   └── panoramica.js                   ← NUOVO (KPI + deep dive router)
├── styles-append.css                   ← da APPENDERE a styles.css
├── index-panoramica-fragment.html      ← rimpiazza <div id="mtab-panoramica">
├── index-scripts-fragment.html         ← 2 <script> da aggiungere a fine <body>
├── manager-patch.js                    ← 2 edit atomici per js/manager.js
└── CLAUDE-md-snippet.md                ← blocco da aggiungere a CLAUDE.md
```

---

## Deploy step-by-step

Il progetto è su GitHub e auto-deployato su Vercel: **ogni push su branch diverso da `main` genera un Preview Deployment**, `main` = produzione. Procedi così:

### 1. Apri un branch nuovo

```bash
git checkout main
git pull origin main
git checkout -b claude/manager-panoramica-consegna-1
```

### 2. Migration Supabase

> ⚠️ Come dice `CLAUDE.md`: **il DB è unico, non c'è staging**. Qualsiasi migration è immediatamente in produzione.
> Questa migration è **additiva e non distruttiva** (2 colonne nullable + 1 indice): sicura da applicare.

Opzione A (consigliata): **Dashboard Supabase → SQL Editor → incolla e run**  
Opzione B: `supabase db push` se hai la CLI configurata  
Opzione C: `psql` direttamente

```bash
# Copia la migration nel repo
cp deploy-consegna1/supabase/migrations/20260425000000_panoramica_deepdive.sql supabase/migrations/
git add supabase/migrations/20260425000000_panoramica_deepdive.sql
```

### 3. Copia i file nel repo

```bash
# JS
cp deploy-consegna1/js/dd-common.js    js/
cp deploy-consegna1/js/panoramica.js   js/

# CSS: APPENDI (non sostituire) styles-append.css a styles.css
cat deploy-consegna1/styles-append.css >> styles.css
```

### 4. Modifica `index.html`

#### 4a. Rimpiazza la tab Panoramica

Apri `index.html`, cerca:

```html
<div id="mtab-panoramica" class="tab-content active">
```

Rimpiazza **tutto quel blocco** (dall'apertura fino al `</div>` che lo chiude) con il contenuto di `deploy-consegna1/index-panoramica-fragment.html`.

#### 4b. Aggiungi i 2 nuovi `<script>`

Scendi fino al fondo del file, prima di `</body>`, trova l'ultimo `<script src="js/…">`. Subito dopo aggiungi:

```html
<script src="js/dd-common.js"></script>
<script src="js/panoramica.js"></script>
```

### 5. Modifica `js/manager.js`

Segui le 2 patch in `deploy-consegna1/manager-patch.js`:

- **Patch 1**: in `loadManagerData()` sostituisci le due chiamate `loadDashboardUpcomingKpis`/`loadDashboardCreditsKpis` con una chiamata a `panoramicaInit()` (incapsulata in un helper di fallback, vedi commento)
- **Patch 2**: in `managerTab(tab, btn)` aggiungi `if (tab === 'panoramica' && typeof panoramicaInit === 'function') panoramicaInit();` dopo `panel.classList.add('active');`

### 6. Aggiorna `CLAUDE.md`

Appendi il contenuto di `deploy-consegna1/CLAUDE-md-snippet.md` alla sezione appropriata (schema tabelle per `citta`/`categoria`, e una nota su `js/panoramica.js` nello stack frontend).

### 7. Commit + push + PR

```bash
git add .
git commit -m "feat(manager): panoramica con 4 KPI cliccabili + router deep-dive

- Toolbar periodo unificata (preset + custom + confronto)
- 4 KPI con sparkline e delta vs periodo precedente
- Flow diagram disp→pren→distr→spent con tassi conversione
- Top 3 ombrelloni del periodo
- Stub deep-dive per le 4 metriche (contenuto ricco in Consegna 2)
- Migration: citta su stabilimenti, categoria su transazioni, index KPI"

git push -u origin claude/manager-panoramica-consegna-1
```

Apri la PR su GitHub. Vercel crea automaticamente il Preview Deployment (link nel commento del bot "vercel" sulla PR).

### 8. Test su Preview

Sul Preview Deployment apri la tab Panoramica e verifica:

- [ ] Toolbar: i preset cambiano range correttamente
- [ ] Range custom via date picker funziona
- [ ] Toggle "Confronta" nasconde/mostra i delta
- [ ] 4 KPI mostrano numeri plausibili e le sparkline sono disegnate
- [ ] Click su una KPI apre il deep dive corrispondente (placeholder + breadcrumb + export stub)
- [ ] "← Panoramica" torna alla overview
- [ ] Responsive: su schermo < 900px le 4 KPI diventano 2×2; < 560px diventano 1×4
- [ ] Delta `▲ / ▼ / =` con colori corretti
- [ ] Top 3 ombrelloni mostra nomi cliente + count notti

### 9. Merge

Se tutto ok, merge della PR su `main` → Vercel deploya automaticamente su `spiaggiamia.com`.

---

## Note

- La Consegna 1 **non rimuove** le KPI vecchie (`stat-liberi-3gg` etc.) dalla logica: sono semplicemente non più renderizzate perché il nuovo HTML non ha quegli ID. Il codice `loadDashboardUpcomingKpis` resta a disposizione come fallback.
- Il deep dive per ora mostra solo placeholder + toolbar + bottone export. La Consegna 2 aggiungerà: grafici a barre, heatmap, pie chart categorie, top spender, tempo medio distr→spent, export Excel funzionante.
- Nessun dato nuovo viene scritto: la migration aggiunge solo colonne nullable. `categoria` verrà popolato solo quando aggiungeremo il selettore "dove è stato speso" al flusso di `credito_usato` (fuori scope Consegna 1).
- `stabilimenti.citta` diventa sorgente del breadcrumb visivo, ma se NULL rimane fallback al valore `currentStabilimento.citta` già usato nel header del manager.
