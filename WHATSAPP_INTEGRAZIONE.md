# SpiaggiaMia — Integrazione notifiche WhatsApp (stato e piano)

Documento di riferimento per la knowledge base del progetto.
Ultimo aggiornamento: 4 giugno 2026 (post-verifica: 3 stagionali in pending Meta; auto-riclassificati MARKETING)

## STATO ATTUALE (TL;DR)

**Integrazione tecnica completa e funzionante end-to-end. Bloccata SOLO da Meta
sull'approvazione finale dei template.**

- ✅ Frontend → Edge Function → Twilio: catena verificata in produzione
- ✅ Twilio Sender `+393520426199` ONLINE, display name "SpiaggiaMia"
- ✅ Profilo WhatsApp Business compilato (descrizione, indirizzo, email, sito web)
- ✅ Reset password manager-driven (Fase 3) — funziona via email, WA in attesa
- 🟡 **Template invito/benvenuto/subaffitto**: ricreati 4 giu (i vecchi erano
  bloccati lato Twilio in `received` da 2+ giorni, mai inoltrati a Meta).
  I nuovi sono in **pending** Meta (verificato il 4 giu via `check-template-status`).
  ⚠️ Meta li ha auto-riclassificati come **MARKETING** invece di UTILITY:
  post-approval andrà richiesto il downgrade a UTILITY su Meta WhatsApp Manager
  (`allow_category_change: true`).
- 🟡 **Template recupero_password v3** (SID `HX64ef2eb0...`): in **pending**
  review Meta. Resta `UTILITY` (contenuto chiaramente transazionale).
- ❌ **Template recupero_password v1**: REJECTED da Meta per
  `subCode=2388299, userMessage=Variables can't be at the start or end of the template`
  → cancellato, sostituito da v2 (poi v3).
- ❌ **Business verification Meta**: NON procedibile (Matteo è persona fisica
  senza P.IVA registrata). Conseguenze: limite 250 conv/24h, review template più
  stringente. Non blocker assoluto per MVP.

**Insight critico confermato dal Meta Business Manager**: nei "Insights" del
numero +393520426199 si vede `Messaggi inviati: 0, Messaggi consegnati: 0, Costi
stimati: $0`. Significa che NESSUNO dei WA "inviati" finora dal sistema è davvero
arrivato sui cellulari dei clienti — Twilio li ha presi in carico (HTTP 200) ma
Meta li ha bloccati al gateway perché i template sono in pending.

## 1. Obiettivo

WhatsApp funziona **in parallelo all'email**: per ogni evento il sistema invia su
email e/o WhatsApp a seconda di telefono + consenso del cliente. Tono WhatsApp
informale. Primo rilascio: notifiche transazionali verso clienti **stagionali**.

## 2. Flusso/eventi (4 messaggi automatici)

1. **Invito** — gestore invita il cliente; link per creare la password
2. **Benvenuto** — quando il cliente completa la registrazione (`auth.js`)
3. **Sub-affitto confermato** — gestore conferma sub-affitto: periodo + credito
4. **Recupero password** — Fase 3, manager-driven via menu ⋮ o bulk modal
   (`richiedi-reset-cliente`)

WhatsApp è dispatcher fire-and-forget accanto a `inviaEmail`. L'errore WA non
blocca mai email o flusso DB.

## 3. Architettura

- **Edge Function `invia-whatsapp`** (v10 al 3 giu 2026):
  - Credenziali e Content SID **da env var** (Supabase secrets), niente tabella DB
  - Accetta sia chiamate server-to-server con SERVICE_KEY sia user-JWT (per
    `recupero_password` con ownership check sul proprietario dello stabilimento)
  - Skip silenzioso se `wa_enabled=false`, `whatsapp_consenso=false`, o telefono
    non E.164 valido
- **Edge Function `richiedi-reset-cliente`** (v4 al 3 giu 2026, Fase 3):
  - Manager-driven: genera recovery link via Admin API, sceglie canale (email/WA),
    invia tramite invia-email o invia-whatsapp
  - Passa il JWT del manager (non SERVICE_KEY) per le chiamate interne — risolve
    401 osservato in prod quando SUPABASE_SERVICE_ROLE_KEY env var non è
    disponibile/valida nel runtime della function
  - Per WA: estrae solo la query string del recovery link (`recoveryUrl.search`)
    e la passa come variabile `{{4}}` — il template Twilio ha prefisso URL fisso
    `https://btnyzzpibedkslhtiizu.supabase.co/auth/v1/verify?{{4}}`
- **Helper frontend** `inviaWhatsapp(tipo, params, stab)` in `js/utils.js`
- **Helper frontend** `richiediResetCliente(clienteId, canale)` in `js/utils.js`
- **Toggle per-stabilimento**: `stabilimenti.wa_enabled` (boolean, default false)
- **Consenso per-cliente**: `clienti_stagionali.whatsapp_consenso` +
  `whatsapp_consenso_at`
- **Secret Supabase richiesti**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WA_FROM=whatsapp:+393520426199`, `WA_SID_INVITO`, `WA_SID_BENVENUTO`,
  `WA_SID_SUBAFFITTO`, `WA_SID_RECUPERO` (quest'ultima da settare quando il v3 è
  approvato → `HX64ef2eb0f7aa4497e97963116ea8b2f2`). I 3 SID stagionali sono
  stati aggiornati il 4 giu 2026 con i nuovi valori post-ricreazione (vedi
  sezione 4).
- **Edge Function `check-template-status`** (creata 4 giu 2026): read-only,
  chiama Twilio Content API v2/ContentAndApprovals e restituisce status
  approval di tutti i template `spiaggiamia_*`. verify_jwt=true.
  Uso rapido da console browser loggato:
  `await sb.functions.invoke('check-template-status').then(r => console.table(r.data.templates))`
- **Edge Function `recreate-whatsapp-templates`** (creata 4 giu 2026):
  delete + recreate identico + submit per i 3 template stagionali quando
  bloccati in `received` lato Twilio. Richiede POST con body
  `{ "confirm": "yes-delete-and-recreate" }`. verify_jwt=true.

## 4. Template Twilio (Content SID definitivi)

Lingua **Italian**. Categoria sottoposta **UTILITY** in tutti i casi, ma Meta ha
auto-riclassificato i 3 stagionali a **MARKETING** al passaggio in pending.
Il `recupero_password_v3` è rimasto UTILITY (contenuto chiaramente transazionale).

1. **`spiaggiamia_invito_stagionale`** — SID `HXcf66089cb849dfcd69bfec8bd5dffe71`
   (ricreato 4 giu 2026; vecchio SID `HXa6ec64d24da74f0d8348c7e180d727e8` cancellato)
   - Call To Action con bottone URL
   - Variabili body: 1=nome, 2=stabilimento
   - Bottone URL dinamico: token invito (chiave `button_1_url_0`)
   - Status: 🟡 **pending** (verificato 4 giu h 16:54 UTC via check-template-status)
   - ⚠️ Categoria assegnata da Meta: **MARKETING** (sottomesso come UTILITY).
     `allow_category_change: true` → richiedere downgrade post-approval.

2. **`spiaggiamia_benvenuto_stagionale`** — SID `HXf3231107ecd0bf19e6737cdc53dfd0d7`
   (ricreato 4 giu 2026; vecchio SID `HXf42d6a56208f5e790550d1e38a9f54a3` cancellato)
   - Text
   - Variabili: 1=nome, 2=stabilimento
   - Status: 🟡 **pending** (verificato 4 giu h 16:54 UTC)
   - ⚠️ Categoria assegnata da Meta: **MARKETING** (sottomesso come UTILITY).
     `allow_category_change: true` → richiedere downgrade post-approval.

3. **`spiaggiamia_subaffitto_confermato`** — SID `HX08068906ff6ec2ee2286405506accd6a`
   (ricreato 4 giu 2026; vecchio SID `HXa9170abc05f727eab8fbd4cfa253779b` cancellato)
   - Text
   - Variabili: 1=nome, 2=periodo, 3=credito guadagnato, 4=credito totale, 5=stabilimento
   - Status: 🟡 **pending** (verificato 4 giu h 16:54 UTC)
   - ⚠️ Categoria assegnata da Meta: **MARKETING** (sottomesso come UTILITY).
     `allow_category_change: true` → richiedere downgrade post-approval.

4. **`spiaggiamia_recupero_password`** (v1) — SID `HXe0b44b18fae266c18cabe3973a5f708f`
   - Call To Action con bottone URL
   - Status Meta: ❌ **REJECTED** il 3 giu 2026
   - Rejection reason: `code=100, subCode=2388299, userMessage=Variables can't be
     at the start or end of the template`
   - Causa: il body terminava con `"... contatta direttamente {{3}}."` — Meta
     considera il `.` non testo sufficiente, vede `{{3}}` come variabile finale
   - Stato: cancellato da Twilio, sostituito dal v2

5. **`spiaggiamia_recupero_password_v2`** — superato dal v3, non più presente su
   Twilio (la query check-template-status del 4 giu non lo restituisce)

6. **`spiaggiamia_recupero_password_v3`** — SID `HX64ef2eb0f7aa4497e97963116ea8b2f2`
   (creato il 3 giu 2026, h 21:35 UTC)
   - Call To Action con bottone URL
   - Body fixato per evitare variabili in posizioni terminali:
     ```
     Reset password per {{1}}

     Ciao {{2}}, è stata richiesta una nuova password per il tuo account
     gestito da {{3}}.

     Tocca il pulsante qui sotto per impostarla. Il link è valido per un'ora.

     Se non hai richiesto tu, ignora questo messaggio o contatta lo stabilimento.
     ```
   - Variabili body: 1=stabilimento (intro), 2=nome cliente, 3=stabilimento (body)
   - Button URL: `https://btnyzzpibedkslhtiizu.supabase.co/auth/v1/verify?{{4}}`
   - Variabile {{4}}: solo la query string del recovery link Supabase (token,
     type, redirect_to). NON l'URL completo (Meta richiede prefisso URL fisso)
   - Status: 🟡 **pending** (verificato 4 giu via check-template-status)
   - Categoria: **UTILITY** (Meta NON l'ha riclassificato, contenuto chiaramente
     transazionale)
   - ⚠️ Quando approvato: settare `WA_SID_RECUPERO=HX64ef2eb0f7aa4497e97963116ea8b2f2`
     su Supabase Secrets

## 5. Numero pilota: BYON eSIM Iliad

- Numero **`+393520426199`**, dedicato a SpiaggiaMia
- Account Twilio paid (Active)
- Sender ONLINE con display name "SpiaggiaMia" approvato
- Twilio WABA ID: 1658468622079031
- Meta Business Manager ID: 982498484190082
- Profilo business compilato il 3 giu 2026: descrizione, indirizzo, email, sito
  web. Categoria: "Servizi locali"

## 6. Vincoli Meta

- **250 conversazioni business-initiated / 24h** finché la business verification
  Meta non è completata
- **Business verification**: NON procedibile per persone fisiche senza P.IVA.
  Quando il business avrà i primi pagamenti reali, valutare apertura P.IVA
  forfettaria → sblocca verification → 1k+ conv/24h
- **Quality rating "Unavailable"** finora — normale per sender appena registrato
- **Categoria template auto-classificata da Meta**: anche se sottoponi un template
  come UTILITY, Meta legge il body e può riclassificarlo (vedi i 3 stagionali
  diventati MARKETING). Implicazioni: costo per messaggio in EU ~4-5x superiore
  per MARKETING vs UTILITY. Se vuoi forzare UTILITY: il flag
  `allow_category_change: true` (presente nei template Twilio) permette di
  richiedere il downgrade post-approval da Meta WhatsApp Manager. In alternativa
  si può modificare il body per renderlo più chiaramente transazionale
  (es. iniziare con "Notifica automatica: …").

## 7. Storia delle iterazioni di approval

### Tentativo 1 (giugno 2026): submission iniziale
3 template (invito, benvenuto, subaffitto) sottomessi per WhatsApp approval Meta
con categoria Utility. Tutti accettati come user-initiated immediatamente. Tutti
**pending** come business-initiated.

### Tentativo 2 (3 giugno 2026): recupero_password v1
Sottomesso con body:
```
Reset password – {{1}}

Ciao {{2}}, è stata richiesta una nuova password per il tuo account SpiaggiaMia
gestito da {{3}}. ... Se non hai richiesto tu il reset, contatta direttamente {{3}}.
```
**Rejected** con motivo `Variables can't be at the start or end of the template`.
Recuperato il motivo via PowerShell + Twilio API:
```powershell
Invoke-RestMethod -Uri "https://content.twilio.com/v1/Content/{SID}/ApprovalRequests" -Headers $headers
```

### Tentativo 3 (3 giugno 2026): recupero_password v2
Sottomesso con body fixato (testo statico alla fine, non variabili). In attesa.

### Ticket Twilio Support (3 giugno 2026)
Aperto da Matteo per segnalare che i template invito/benvenuto/subaffitto sono
pending Meta da >48h, fuori dai SLA tipici (6-24h).

### Tentativo 4 (4 giugno 2026): ricreazione stagionali
Verificato su Meta WhatsApp Manager che i 3 template stagionali (`invito`,
`benvenuto`, `subaffitto`) non erano mai stati inoltrati da Twilio a Meta
(status `received` da 2+ giorni — su Meta non comparivano affatto). Diagnosi
confermata interpretando correttamente gli status Twilio: `received` =
sottoposto a Twilio ma non ancora inoltrato a Meta; `pending` = già a Meta.

Tramite la nuova Edge Function `recreate-whatsapp-templates`, cancellati e
ricreati identici. Nuovi SID:
- `spiaggiamia_invito_stagionale` → `HXcf66089cb849dfcd69bfec8bd5dffe71`
  (vecchio `HXa6ec64d24da74f0d8348c7e180d727e8`)
- `spiaggiamia_benvenuto_stagionale` → `HXf3231107ecd0bf19e6737cdc53dfd0d7`
  (vecchio `HXf42d6a56208f5e790550d1e38a9f54a3`)
- `spiaggiamia_subaffitto_confermato` → `HX08068906ff6ec2ee2286405506accd6a`
  (vecchio `HXa9170abc05f727eab8fbd4cfa253779b`)

Status post-ricreazione: `received` (ri-sottomessi 4 giu h 16:40-16:41 UTC),
poi **passati a `pending` entro ~13 minuti** (verificato h 16:54 UTC via
`check-template-status` → conferma che il blocco precedente era specifico
delle vecchie submission, non un problema account-wide).

⚠️ **Imprevisto**: Meta ha auto-riclassificato i 3 template da `UTILITY`
(categoria sottoposta dallo script) a `MARKETING`. Implicazioni:
- Costo per messaggio in EU significativamente più alto (~4-5x rispetto a UTILITY)
- Il `recupero_password_v3` è rimasto UTILITY (probabilmente perché il
  contenuto "reset password" è inequivocabilmente transazionale)
- I 3 stagionali contengono "benvenuto", "invitato", "guadagnato crediti" →
  il classificatore Meta li ha visti come marketing

**Strategia post-approval**: una volta che Meta approva, su
**Meta WhatsApp Manager → Modelli di messaggio → ciascuno dei 3** richiedere
il downgrade categoria a `UTILITY` (`allow_category_change: true` lo permette).
Motivare con: *"Transactional notification for seasonal beach client lifecycle,
not promotional"*. Se Meta rifiuta, valutare modifica body per renderlo più
chiaramente transazionale (es. iniziare con "Notifica automatica: …").

**Secret Supabase aggiornati il 4 giu**: i 3 `WA_SID_INVITO`, `WA_SID_BENVENUTO`,
`WA_SID_SUBAFFITTO` puntano ora ai nuovi SID. `invia-whatsapp` opererà sui
nuovi template al primo evento utile post-approval.

## 8. Fase 3 — Reset password manager-driven

Completata in main il 3 giu 2026. PR #104 + #105 + #106 + commit standalone.

- Frontend: menu ⋮ contestuale al posto di "[Invita]" in tabella Ombrelloni/Clienti
- 6 azioni: copia link, invito email/WA, rigenera link, reset email/WA
- Bulk modale unificato: accetta selezione mista (registrati + non-registrati),
  auto-split INVITO vs RESET con badge colorati
- Backend: nuova Edge Function `richiedi-reset-cliente` (manager-driven con
  ownership check)
- Esteso `invia-email` con tipo `reset_password` (template HTML + CTA)

Test reset password via **email**: ✅ funziona end-to-end (testato cliente
Matteo Posterli ombrellone 100, email reale).

Test reset password via **WhatsApp**: tecnicamente parte (HTTP 200, alert success
✅), MA il messaggio NON arriva sul cellulare perché il template Meta non è
ancora approvato. Verifica nel Meta Business Manager → Insights: 0 messaggi
consegnati.

## 9. STATO DEGLI STEP

- [x] **0. Strategia / provider Twilio / architettura** — definite
- [x] **1. Migration consenso** — `whatsapp_consenso` + `whatsapp_consenso_at`
- [x] **5a. Consenso in anagrafica gestore** — checkbox nel form modifica cliente
- [x] **5b. Preferenze dashboard stagionale** — scheda "Notifiche"
- [x] **2. Setup Twilio** — account paid, secret configurati
- [x] **2b. WhatsApp Sender BYON** — eSIM Iliad `+393520426199` ONLINE
- [x] **3. Template invito/benvenuto/subaffitto** — creati con Content SID
- [x] **4a. Tab WhatsApp gestore** — sub-tab Configurazioni + tab Comunicazioni
- [x] **4b. Edge Function `invia-whatsapp`** — v10 ACTIVE (3 giu 2026, accetta
      manager-auth + ownership per recupero_password)
- [x] **4b-bis. Agganci agli eventi** — tutti completi (invito, benvenuto, subaffitto)
- [x] **Cleanup `whatsapp_config`** — tabella eliminata
- [x] **Fase 3 — Reset password manager-driven** — completa, in main
- [x] **richiedi-reset-cliente Edge Function** — v4 ACTIVE (3 giu 2026)
- [x] **Profilo WhatsApp Business completo** — descrizione, indirizzo, email, sito
- [x] **Recupero password v1 sottomesso** — rejected per "variables at start/end"
- [x] **Recupero password v3 sottomesso** — pending review Meta (v2 superato)
- [x] **Edge Function check-template-status** (read-only) — 4 giu 2026
- [x] **Edge Function recreate-whatsapp-templates** — 4 giu 2026
- [x] **Ricreazione template stagionali** — 4 giu 2026
- [x] **Secret Supabase aggiornati con nuovi SID** — `WA_SID_INVITO`, `WA_SID_BENVENUTO`, `WA_SID_SUBAFFITTO` (4 giu 2026)
- [x] **Verifica passaggio a pending Meta** — i 3 stagionali in pending ~13min dopo ricreazione (4 giu h 16:54 UTC)
- [ ] **Approvazione Meta business-initiated dei 3 template invito/benvenuto/subaffitto** (status: pending, ricreati 4 giu, categoria assegnata MARKETING)
- [ ] **Approvazione Meta recupero_password v3** (SID `HX64ef2eb0...`, status: pending, categoria UTILITY)
- [ ] **Downgrade categoria MARKETING → UTILITY** per i 3 stagionali (post-approval, via Meta WhatsApp Manager)
- [ ] **WA_SID_RECUPERO settato su Supabase Secrets** (post-approval v3)
- [ ] **Test end-to-end WA recupero password** sul cellulare (post-approval)
- [ ] **Business verification Meta** — bloccata da mancanza P.IVA (long term)

## 10. Come riprendere il test (quando Meta approva)

**Quando i 4 template diventano verdi per business-initiated:**

1. **Per i 3 template invito/benvenuto/subaffitto**: nessun cambio codice
   necessario, Edge Functions già pronte e secret aggiornati → al primo
   evento (invito/benvenuto/subaffitto) i WA dovrebbero partire automaticamente.
   ⚠️ Subito dopo l'approval, valutare richiesta downgrade categoria
   `MARKETING → UTILITY` su Meta WhatsApp Manager.

2. **Per recupero_password v3** (SID `HX64ef2eb0f7aa4497e97963116ea8b2f2`):
   - Supabase Dashboard → Edge Functions → Secrets → aggiungi/aggiorna
     `WA_SID_RECUPERO` = `HX64ef2eb0f7aa4497e97963116ea8b2f2`
   - Nessun redeploy necessario (env var lette al runtime)
   - Test browser: ⋮ su Nicola Rizzo (ombrellone 104) → "Invia reset password
     via WhatsApp" → atteso WA sul cellulare con button "Imposta nuova password"

3. **Verifica delivery reale**: dopo qualsiasi test WA, controlla Meta Business
   Manager → WhatsApp Manager → Numeri di telefono → click sul numero → tab
   Insights → "Tutti i messaggi" → deve aumentare "Messaggi inviati" e
   "Messaggi consegnati" (NON solo "ricevuti"). Se restano a 0, Meta ha
   bloccato il template. Se aumentano, è arrivato.

## 11. Per nuove sessioni Claude

Leggi questo file con `get_file_contents` per orientarti. Punti chiave:
- Tutta l'infrastruttura tecnica è in main e in produzione
- Edge functions deployate: `invia-whatsapp` v10, `richiedi-reset-cliente` v4,
  `check-template-status`, `recreate-whatsapp-templates`
- Manca solo l'approvazione Meta dei template (asincrona, fuori controllo)
- Per recupero_password specifico: serve attendere v3 approval + settare
  `WA_SID_RECUPERO=HX64ef2eb0f7aa4497e97963116ea8b2f2` su Supabase Secrets
- Per i 3 stagionali: post-approval, richiedere downgrade categoria
  `MARKETING → UTILITY` su Meta WhatsApp Manager (per ridurre costo per messaggio)

Verifica status template:
- Edge Function `check-template-status` (read-only, da console browser loggato
  manager: `sb.functions.invoke('check-template-status')`) — modo più rapido
- https://console.twilio.com/us1/develop/sms/content-template-builder
- https://business.facebook.com/latest/whatsapp_manager/message_templates
- Cerca i template `spiaggiamia_*`
- Status Twilio: `unsubmitted → received → pending → approved/rejected`
  (`received` = Twilio ce l'ha ma non l'ha ancora inoltrato a Meta;
  `pending` = già a Meta in review)

## 12. UUID stabilimenti (riferimento)

| Nome | UUID | wa_enabled |
|------|------|------------|
| Universo (test in corso) | `2c82f99e-992e-4935-9aa7-9d0bd94d9799` | true |
| dede | `5f0cf433-eaf7-4b8b-9da6-a87d972abdda` | false |

## 13. Clienti di test pilota

| Nome | Ombrellone | Telefono | WA consenso | Note |
|------|------------|----------|-------------|------|
| Matteo Posterli | 100 | +393299088725 | false | Registrato, email reale |
| Nicola Rizzo | 104 | +393339876543 | true | Registrato, email sintetica |
| Andrea Lombardi | 105 | +393299088725 | true | Non registrato |
