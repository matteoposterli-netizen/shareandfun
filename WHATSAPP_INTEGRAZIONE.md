# SpiaggiaMia — Integrazione notifiche WhatsApp (stato e piano)

Documento di riferimento per la knowledge base del progetto.
Ultimo aggiornamento: 5 giugno 2026 — BUGFIX frontend `doForgotPassword`:
sostituita fetch raw con `sb.functions.invoke()` per evitare 401 dal gateway
Supabase quando l'utente non è loggato. Vedi sezione 7 - Tentativo 9.

## STATO ATTUALE (TL;DR)

**Tutti i flussi password via WhatsApp: FUNZIONANTI end-to-end (5 giu 2026).**
Il template `spiaggiamia_recupero_password_v3` è stato approvato da Meta tra il
4 e il 5 giugno, il messaggio arriva correttamente sul cellulare. Bug nel
codice (URL `?` mancante) trovato e fixato in DUE edge function distinte:
`richiedi-reset-cliente` (manager-driven) e `recupero-password` (self-service
dal link "Password dimenticata?" della pagina login). **Inoltre** fixato un
terzo bug nel frontend (`js/auth.js`) che faceva tornare 401 dal gateway sulla
chiamata a `recupero-password` quando l'utente non era loggato. Restano in
attesa di approval Meta i 3 template stagionali (invito/benvenuto/subaffitto)
e i 9 template UTILITY backup.

**Profilo business WhatsApp aggiornato via API (5 giu 2026):** logo brand
SpiaggiaMia (ombrellone giallo/bianco su gradient ocean) settato come avatar
del numero +393520426199, plus description, vertical (Travel and
Transportation), email, sito web — tutto via la nuova Edge Function
`manage-wa-business-profile` (Twilio Senders API v2).

- ✅ Frontend → Edge Function → Twilio: catena verificata in produzione
- ✅ Twilio Sender `+393520426199` ONLINE, display name "SpiaggiaMia"
- ✅ **Profilo WhatsApp Business aggiornato via API 5 giu 2026** (logo brand,
  description, vertical, email, sito, about) — vedi Tentativo 8 sezione 7
- ✅ Reset password manager-driven (Fase 3) — funziona via email
- ✅ **Reset password manager-driven via WhatsApp — FUNZIONANTE** (post-bugfix 5 giu 2026 in `richiedi-reset-cliente`)
- ✅ **Recupero password self-service via WhatsApp — FUNZIONANTE** (post-bugfix 5 giu 2026 in `recupero-password` + frontend `js/auth.js`)
- ✅ Template `recupero_password_v3` APPROVATO Meta (categoria UTILITY)
- ✅ `WA_SID_RECUPERO` settato su Supabase Secrets (`HX64ef2eb0...`)
- 🟡 **Template invito/benvenuto/subaffitto**: ricreati 4 giu (i vecchi erano
  bloccati lato Twilio in `received` da 2+ giorni, mai inoltrati a Meta).
  I nuovi sono in **pending** Meta. ⚠️ Meta li ha auto-riclassificati come
  **MARKETING** invece di UTILITY (sottoposti come UTILITY). **Appeal categoria
  sottomesso il 4 giu** su Meta Business Manager → Aggiornamenti categoria
  modelli → "Richiedi revisione" (un click, no motivazione testuale richiesta).
  Esito atteso entro 24-72h: Ripristinati (= UTILITY) o Invariati (= MARKETING).
- 🟡 **9 template UTILITY backup** (safe/medium/warm × 3 eventi): sottomessi
  4 giu h 21:36 UTC come UTILITY con `allow_category_change: true`. Status
  iniziale Twilio: tutti `received`. In attesa inoltro Meta + classificazione.
  SID popolati in sezione 4.
- ❌ **Template recupero_password v1**: REJECTED da Meta per
  `subCode=2388299, userMessage=Variables can't be at the start or end of the template`
  → cancellato, sostituito da v2 (poi v3).
- ❌ **Business verification Meta**: NON procedibile (Matteo è persona fisica
  senza P.IVA registrata). Conseguenze: limite 250 conv/24h, review template più
  stringente. Non blocker assoluto per MVP.

## 1. Obiettivo

WhatsApp funziona **in parallelo all'email**: per ogni evento il sistema invia su
email e/o WhatsApp a seconda di telefono + consenso del cliente. Tono WhatsApp
informale. Primo rilascio: notifiche transazionali verso clienti **stagionali**.

## 2. Flusso/eventi (4 messaggi automatici + 1 self-service)

1. **Invito** — gestore invita il cliente; link per creare la password
2. **Benvenuto** — quando il cliente completa la registrazione (`auth.js`)
3. **Sub-affitto confermato** — gestore conferma sub-affitto: periodo + credito
4. **Reset password manager-driven** — Fase 3, gestore tramite menu ⋮ o bulk modal
   (`richiedi-reset-cliente`)
5. **Recupero password self-service** — cliente stagionale dalla pagina login
   clicca "Password dimenticata?" e inserisce telefono (`recupero-password`).
   Branch email è gestito client-side via `supabase.auth.resetPasswordForEmail()`,
   branch telefono passa per la edge function `recupero-password` che genera
   il recovery link e lo invia via `invia-whatsapp` tipo `recupero_password`.

WhatsApp è dispatcher fire-and-forget accanto a `inviaEmail`. L'errore WA non
blocca mai email o flusso DB.

## 3. Architettura

- **Edge Function `invia-whatsapp`** (v10 al 3 giu 2026):
  - Credenziali e Content SID **da env var** (Supabase secrets), niente tabella DB
  - Accetta sia chiamate server-to-server con SERVICE_KEY (es. `recupero-password`
    self-service) sia user-JWT (per `recupero_password` con ownership check sul
    proprietario dello stabilimento, es. `richiedi-reset-cliente` manager-driven)
  - Skip silenzioso se `wa_enabled=false`, `whatsapp_consenso=false`, o telefono
    non E.164 valido
- **Edge Function `richiedi-reset-cliente`** (v5/v12 al 5 giu 2026, Fase 3 + bugfix URL):
  - Manager-driven: genera recovery link via Admin API, sceglie canale (email/WA),
    invia tramite invia-email o invia-whatsapp
  - Passa il JWT del manager (non SERVICE_KEY) per le chiamate interne — risolve
    401 osservato in prod quando SUPABASE_SERVICE_ROLE_KEY env var non è
    disponibile/valida nel runtime della function
  - Per WA: estrae la **query string completa (incluso `?` iniziale)** del
    recovery link e la passa come variabile `{{4}}` — il template Twilio ha
    prefisso URL fisso `https://btnyzzpibedkslhtiizu.supabase.co/auth/v1/verify{{4}}`
    (notare: SENZA `?` tra `verify` e `{{4}}` — Meta lo rimuove durante
    l'approval normalizzando l'URL). Il `?` è quindi parte della variabile.
- **Edge Function `recupero-password`** (post-bugfix 5 giu 2026, self-service):
  - Solo ramo telefono (ramo email gestito client-side via
    `supabase.auth.resetPasswordForEmail()`)
  - Risponde sempre `{ ok: true }` per evitare enumeration attack
  - Trova cliente registrato → genera recovery link via Admin API → chiama
    `invia-whatsapp` con SERVICE_KEY (server-to-server) e tipo `recupero_password`
  - **Stesso pattern URL del manager-driven**: estrae `recoveryUrl.search` (con
    `?` iniziale) e lo passa come variabile `link` → `invia-whatsapp` lo
    inoltra come `{{4}}` al template Twilio. Il template ricompone l'URL
    Supabase corretto.
  - **verify_jwt=true** lato gateway: il frontend deve chiamare con un JWT
    valido (anon key è sufficiente). Vedi BUGFIX frontend 5 giu in Tentativo 9.
- **Edge Function `manage-wa-business-profile`** (creata 5 giu 2026, v3 ACTIVE):
  - Gestisce il profilo business WhatsApp via **Twilio Senders API v2**
    (`https://messaging.twilio.com/v2/Channels/Senders`)
  - Modes (query param `?mode=...`):
    - `list` — elenca tutti i sender disponibili (debug). **Query Twilio
      richiede `&Channel=whatsapp`** obbligatorio (errore 20001 senza)
    - `get` (default) — auto-detect del sender WA per `+393520426199`,
      ritorna profilo attuale, status (`ONLINE`/`ONLINE:UPDATING`), webhook,
      configuration, WABA ID
    - `update` — aggiorna campi profilo (about/address/description/emails/
      websites/vertical/logo_url/banner_url). Solo admin (check email caller).
      Body JSON con chiave `profile`.
  - **verify_jwt=true**. Per `update`, controllo aggiuntivo: estrae il token
    dall'header Authorization e lo passa direttamente a `supa.auth.getUser(token)`.
    ⚠️ Pattern noto: il pattern alternativo `createClient(URL, KEY, { global:
    { headers: { Authorization } } })` + `supa.auth.getUser()` NON funziona —
    fa firmare con l'anon key invece del JWT utente, ritornando `null`. È
    successo in v1 della function: il caller risultava "anonymous" pur essendo
    loggato. Fix in v3.
- **Helper frontend** `inviaWhatsapp(tipo, params, stab)` in `js/utils.js`
- **Helper frontend** `richiediResetCliente(clienteId, canale)` in `js/utils.js`
- **Frontend `doForgotPassword`** in `js/auth.js` (post-bugfix 5 giu 2026):
  usa `sb.functions.invoke('recupero-password', { body })` invece di fetch
  raw. Il client supabase-js gestisce automaticamente l'Authorization (anon
  key se non loggato). Vedi Tentativo 9 sezione 7.
- **Toggle per-stabilimento**: `stabilimenti.wa_enabled` (boolean, default false)
- **Consenso per-cliente**: `clienti_stagionali.whatsapp_consenso` +
  `whatsapp_consenso_at`
- **Secret Supabase richiesti**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WA_FROM=whatsapp:+393520426199`, `WA_SID_INVITO`, `WA_SID_BENVENUTO`,
  `WA_SID_SUBAFFITTO`, `WA_SID_RECUPERO`. Quest'ultima settata il 4-5 giu 2026
  a `HX64ef2eb0f7aa4497e97963116ea8b2f2` (template approvato Meta).
- **Edge Function `check-template-status`** (creata 4 giu 2026, v8 al 4 giu):
  read-only, chiama Twilio Content API v2/ContentAndApprovals e restituisce
  status approval di tutti i template `spiaggiamia_*` PLUS blocco
  `secrets_check` per verificare gli WA_SID_* settati su Supabase. verify_jwt=true.
  Uso rapido da console browser loggato:
  `await sb.functions.invoke('check-template-status').then(r => console.table(r.data.templates))`
- **Edge Function `recreate-whatsapp-templates`** (creata 4 giu 2026):
  delete + recreate identico + submit per i 3 template stagionali quando
  bloccati in `received` lato Twilio. Richiede POST con body
  `{ "confirm": "yes-delete-and-recreate" }`. verify_jwt=true.
- **Edge Function `create-utility-backup-templates`** (creata 4 giu 2026):
  crea e sottomette 9 template UTILITY backup (safe/medium/warm × 3 eventi)
  in single shot. Richiede POST con body `{ "confirm": "yes-create-utility-backups" }`.
  Pre-step integrato: legge il template `spiaggiamia_invito_stagionale` esistente
  per verificare il pattern URL del bottone (output `invito_button_reference`).
  verify_jwt=true. Anche accessibile via bottoni nel `devboard.html`
  (sezione "WhatsApp Templates Tools", mobile-friendly).
- **Asset brand** `assets/wa-profile-picture.jpg` (commit `b7527413` del
  4 giu 2026, 27.2 KB, 640×640 JPG): logo SpiaggiaMia per il profilo WhatsApp,
  ombrellone bianco/giallo a settori alternati con sole con glow caldo, su
  gradient verticale ocean #38bdf8 → #0ea5e9 → #0369a1. Generato via PIL.
  Servito da Vercel a `https://spiaggiamia.com/assets/wa-profile-picture.jpg`
  e usato come `logo_url` nell'update del profilo business.
- **DevBoard mobile-friendly** `devboard.html`: dalle versioni del 4-5 giu 2026
  contiene 2 sezioni admin per gestione WA da cellulare (auth: solo
  matteo.posterli@gmail.com):
  - **"💬 WhatsApp Templates Tools"** — bottoni "Crea 9 backup templates" e
    "Check template status" che invocano le rispettive edge function
  - **"👤 WhatsApp Business Profile"** — bottoni "Get WA profile",
    "List senders (debug)", "Update WA profile" con textarea payload JSON
    editabile inline (default pre-popolato per SpiaggiaMia). Conferma popup
    prima dell'update. Helper `copyToClipboard` con fallback
    `document.execCommand` per Chrome Android dove `navigator.clipboard`
    fallisce silenziosamente.

## 4. Template Twilio (Content SID definitivi)

Lingua **Italian**. Categoria sottoposta **UTILITY** in tutti i casi, ma Meta ha
auto-riclassificato i 3 stagionali a **MARKETING** al passaggio in pending.
Il `recupero_password_v3` è rimasto UTILITY (contenuto chiaramente transazionale).
**Appeal categoria sottomesso il 4 giu 2026 per i 3 stagionali**.

1. **`spiaggiamia_invito_stagionale`** — SID `HXcf66089cb849dfcd69bfec8bd5dffe71`
   (ricreato 4 giu 2026; vecchio SID `HXa6ec64d24da74f0d8348c7e180d727e8` cancellato)
   - Call To Action con bottone URL
   - Variabili body: 1=nome, 2=stabilimento
   - Bottone URL dinamico: token invito (chiave `button_1_url_0`)
   - URL pattern verificato 4 giu h 21:36 UTC: `https://spiaggiamia.com/?invito={{3}}`
   - Status approval: 🟡 **pending** (verificato 4 giu h 16:54 UTC)
   - Categoria assegnata da Meta: **MARKETING** (sottomesso come UTILITY).
   - 🔄 **Appeal categoria sottomesso 4 giu** — esito atteso 24-72h.

2. **`spiaggiamia_benvenuto_stagionale`** — SID `HXf3231107ecd0bf19e6737cdc53dfd0d7`
   (ricreato 4 giu 2026; vecchio SID `HXf42d6a56208f5e790550d1e38a9f54a3` cancellato)
   - Text
   - Variabili: 1=nome, 2=stabilimento
   - Status approval: 🟡 **pending** (verificato 4 giu h 16:54 UTC)
   - Categoria assegnata da Meta: **MARKETING** (sottomesso come UTILITY).
   - 🔄 **Appeal categoria sottomesso 4 giu** — esito atteso 24-72h.

3. **`spiaggiamia_subaffitto_confermato`** — SID `HX08068906ff6ec2ee2286405506accd6a`
   (ricreato 4 giu 2026; vecchio SID `HXa9170abc05f727eab8fbd4cfa253779b` cancellato)
   - Text
   - Variabili: 1=nome, 2=periodo, 3=credito guadagnato, 4=credito totale, 5=stabilimento
   - Status approval: 🟡 **pending** (verificato 4 giu h 16:54 UTC)
   - Categoria assegnata da Meta: **MARKETING** (sottomesso come UTILITY).
   - 🔄 **Appeal categoria sottomesso 4 giu** — esito atteso 24-72h.

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
   - Button URL **APPROVED** (verificato empiricamente 5 giu 2026 da URL del
     bottone copiato dal cellulare): `https://btnyzzpibedkslhtiizu.supabase.co/auth/v1/verify{{4}}`
     **(SENZA `?` tra `verify` e `{{4}}`)**. ⚠️ Meta ha rimosso/normalizzato
     il `?` durante l'approval. La variabile {{4}} DEVE quindi iniziare con `?`
     per ricomporre l'URL corretto. Vedi BUGFIX 5 giu 2026 in
     `richiedi-reset-cliente/index.ts` e `recupero-password/index.ts`.
   - Variabile {{4}}: la query string COMPLETA del recovery link Supabase,
     incluso `?` iniziale (`?token=...&type=recovery&redirect_to=...`).
   - Status: ✅ **APPROVED** Meta (verificato 5 giu 2026 - messaggio arrivato e
     bottone funzionante post-bugfix codice in entrambe le edge function)
   - Categoria: **UTILITY** (Meta NON l'ha riclassificato, contenuto chiaramente
     transazionale)

### Template UTILITY backup (creati 4 giugno 2026 h 21:36 UTC)
Set di 9 template di backup creati per offrire un'alternativa ai 3 template stagionali
attualmente in appeal MARKETING. Tutti sottoposti come UTILITY con
`allow_category_change: true`. Logica: 3 livelli di calore (safe / medium / warm) per
ognuno dei 3 eventi (accesso / registrazione / operazione). Body ottimizzati dopo
lettura della policy Meta (incipit transazionale, niente parole-trigger MARKETING,
emoji limitate a contesto stato/servizio).

Creati via Edge Function `create-utility-backup-templates` (POST body
`{ "confirm": "yes-create-utility-backups" }`, verify_jwt=true). Invocazione iniziale
fatta 4 giu h 21:36 UTC dal devboard.html. Pre-step pattern URL invito verificato:
`https://spiaggiamia.com/?invito={{3}}` (allineato col template `spiaggiamia_invito_stagionale` esistente).

| Friendly name | Evento | Livello | SID | Status iniziale |
|---|---|---|---|---|
| spiaggiamia_accesso_safe | accesso | safe | `HX482b55b886fb9719dac87795b61b37a1` | received |
| spiaggiamia_accesso_medium | accesso | medium | `HXe499683276d00a22dd991762baa2dc91` | received |
| spiaggiamia_accesso_warm | accesso | warm | `HXd1aa8cdf29a288f417f2de46634dd2a6` | received |
| spiaggiamia_registrazione_safe | registrazione | safe | `HXe72b5b349616eb0b901e6e6a6e162c7a` | received |
| spiaggiamia_registrazione_medium | registrazione | medium | `HX83ee028cd853653a0dbc8dc4cfe8e54c` | received |
| spiaggiamia_registrazione_warm | registrazione | warm | `HXa462e50691efc451ee445dcbf14a731c` | received |
| spiaggiamia_operazione_safe | operazione | safe | `HX3004b49698e33e8c07667c546e1848e4` | received |
| spiaggiamia_operazione_medium | operazione | medium | `HXdff730c3df8bea037efb5ee38c000cf3` | received |
| spiaggiamia_operazione_warm | operazione | warm | `HXac7ccf9dea0b5fc4ccc2952ed18c8084` | received |

**Quando swappare**: se appeal categoria dei 3 attuali "stagionali" viene respinto
(esito "Invariati"), settare su Supabase Secrets:
- WA_SID_INVITO = <SID accesso_safe o accesso_warm a discrezione>
- WA_SID_BENVENUTO = <SID registrazione_safe o registrazione_warm>
- WA_SID_SUBAFFITTO = <SID operazione_safe o operazione_warm>

⚠️ **Nota cambio signature variabili per A, B e C** (i backup usano numerazione
variabile globale per il bottone, diversa dai 3 stagionali attuali):
- I template `accesso_*` hanno il bottone su {{3}} = token invito (i 3 stagionali
  attuali passano il token con chiave ContentVariables `button_1_url_0`)
- I template `registrazione_*` hanno 3 variabili totali (era 2): aggiunta {{3}} = email URL-encoded per il bottone
- I template `operazione_*` hanno 6 variabili totali (era 5): aggiunta {{6}} = email URL-encoded per il bottone
- Se viene swappato il secret, `invia-whatsapp` v10 deve essere aggiornato per passare
  le variabili bottone aggiuntive ({{3}} per accesso/registrazione, {{6}} per
  operazione). È OPEN ITEM, da fare prima dello swap.

## 5. Numero pilota: BYON eSIM Iliad

- Numero **`+393520426199`**, dedicato a SpiaggiaMia
- Account Twilio paid (Active)
- Sender ONLINE con display name "SpiaggiaMia" approvato
- Sender SID Twilio: `XE332bf468c429bee57ea725b7fe0afb13`
- Twilio WABA ID: 1658468622079031
- Meta Business Manager ID: 982498484190082
- Profilo business compilato originariamente il 3 giu 2026 via Twilio Console
  (descrizione, indirizzo, email, sito web, categoria "Servizi locali"),
  **ricompilato via API 5 giu 2026** con:
  - **logo brand** `https://spiaggiamia.com/assets/wa-profile-picture.jpg`
    (ombrellone bianco/giallo + sole su gradient ocean)
  - **about**: "Stagione in spiaggia, organizzata."
  - **description**: "SpiaggiaMia organizza il tuo ombrellone stagionale:
    prenotazioni, sub-affitti, crediti e comunicazioni in un'unica piattaforma."
  - **emails**: `matteo.posterli@gmail.com`
  - **websites**: `https://spiaggiamia.com`
  - **vertical**: `Travel and Transportation` (riclassificato dalla
    precedente "Servizi locali")
- Display name "SpiaggiaMia" approvato a livello Twilio, ma **non sempre
  visibile come header chat** sul cellulare destinatario. Per averlo sempre
  prominente servirebbe l'**Official Business Account** Meta (badge spunta
  verde), che richiede business verification con P.IVA → non procedibile ora.
  Workaround locale: salvare il numero come contatto "SpiaggiaMia" sul cell
  destinatario. Per le demo, il logo nel profilo business è comunque visibile
  tappando il header del numero.

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
- ⚠️ **Normalizzazione URL del button**: Meta può rimuovere o modificare
  caratteri "speciali" nell'URL del bottone durante l'approval. Verificato 5 giu
  2026: il `?` tra path e `{{variabile}}` viene rimosso (`verify?{{4}}` →
  `verify{{4}}`). Soluzione: includere il `?` nel valore della variabile, non
  hardcodarlo nel template URL. Altri caratteri di query (`=`, `&`) sono invece
  preservati nel valore della variabile (NON URL-encoded da Meta).
- **Workflow appeal categoria** (testato e funzionante il 4 giu 2026):
  1. Meta Business Manager → seleziona business "SpiaggiaMia" → Account WhatsApp
  2. Nel banner giallo "X modelli sono stati ricategorizzati come di marketing"
     cliccare "Controlla gli aggiornamenti delle categorie in Home dell'assistenza
     per le aziende"
  3. Sidebar → "Aggiornamenti categoria modelli" → tab "Available for review"
  4. Spuntare i template da appellare (preferibilmente uno alla volta per
     tracking individuale) e cliccare il pulsante blu **"Richiedi revisione"**
     in alto. NON cliccare "Vedi dettagli" perché porta solo a "Modifica modello"
     (un flusso diverso, per editare il body).
  5. Conferma con popup "Successfully submitted appeal!" — **nessuna motivazione
     testuale richiesta**, il contesto è implicito dalla pagina (= sto contestando
     la riclassificazione di categoria).
  6. Template passa da tab "Available for review" → tab "In fase di controllo"
     con stato `Pending`. Esito atteso entro 24-72h:
     - **Ripristinati** → ✅ accolto, torna UTILITY
     - **Invariati** → ❌ rigettato, resta MARKETING (a quel punto valutare
       modifica body o accettare il costo MARKETING)
  7. Scadenza del diritto di appeal: 60 giorni dall'auto-riclassificazione.
- **Shape vincoli Twilio Senders API** (scoperti 5 giu 2026 durante
  l'integrazione del profilo via API):
  - `/v2/Channels/Senders` (list) richiede `Channel=whatsapp` obbligatorio
    (errore 20001 "Missing required parameter Channel" altrimenti)
  - `profile.emails` e `profile.websites` sono **array di oggetti**, NON
    array di stringhe: `[{ email, label }]` e `[{ website, label }]`
  - `profile.vertical` accetta solo l'enum esatto Twilio (case-sensitive,
    con spazi): vedi sezione 7 - Tentativo 8 per la lista completa. Valori
    corti tipo "TRAVEL" generano errore 63100
  - Il response dell'update ha status `202 Accepted` (non 200) con
    `status: "ONLINE:UPDATING"` finché Meta non ha completato la propagazione.
    Successivo Get mostrerà `ONLINE` quando propagato (1-5 min tipicamente)

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

**Secret Supabase aggiornati il 4 giu**: i 3 `WA_SID_INVITO`, `WA_SID_BENVENUTO`,
`WA_SID_SUBAFFITTO` puntano ora ai nuovi SID. `invia-whatsapp` opererà sui
nuovi template al primo evento utile post-approval.

### Tentativo 5 (4 giugno 2026, post-ricreazione): appeal categoria stagionali
Per contestare la riclassificazione MARKETING dei 3 template stagionali,
sottomesso appeal tramite **Meta Business Manager → Aggiornamenti categoria
modelli → tab "Available for review" → "Richiedi revisione"** per ciascuno dei
3 template (sequenza: subaffitto, benvenuto, invito).

**Scoperta utile per future occasioni**: NON è richiesta motivazione testuale —
basta selezionare + cliccare "Richiedi revisione". Il contesto è implicito
dalla pagina (= "sto contestando la riclassificazione di categoria del/i
template selezionato/i"). Conferma immediata via popup "Successfully submitted
appeal!". Template spostati dalla tab "Available for review" alla tab
"In fase di controllo" con stato `Pending` (lato appeal).

Esito atteso entro 24-72h:
- **Ripristinati** → ✅ Meta accoglie, categoria torna UTILITY
- **Invariati** → ❌ Meta conferma MARKETING. In quel caso, valutare modifica
  body (prefisso "Notifica automatica: …") e re-submission del template, oppure
  accettare il costo MARKETING per i primi mesi.

Il processo di approval business-initiated continua indipendentemente
dall'appeal: se Meta approva i template prima della decisione sull'appeal,
diventano operativi (anche se come MARKETING) e l'eventuale riclassificazione
a UTILITY post-appeal avviene senza dover rifare l'approval.

### Tentativo 6 (4 giugno 2026 h 21:36 UTC): set di 9 template UTILITY backup
Creato il set parallelo via nuova Edge Function `create-utility-backup-templates`.
Razionale: dopo lettura policy Meta ufficiale (Template Categorization), ottimizzato il
calore in 3 livelli (safe/medium/warm) e introdotto bottone "Accedi alla tua area" su
registrazione e operazione (con pattern URL `https://spiaggiamia.com/?login={{N}}`,
gestito dal frontend in `js/main.js`).

Tutti e 9 sottomessi come UTILITY con `allow_category_change: true` e status iniziale
`received` (output: `summary.ok=9, failed=0`). Atteso esito Meta in 24-72h. Il set
serve come piano B nel caso l'appeal categoria sui 3 attuali stagionali venga respinto.

Pre-step verification: il pattern URL del bottone "accesso" letto dal template
esistente `spiaggiamia_invito_stagionale` (`https://spiaggiamia.com/?invito={{3}}`)
coincide con quello atteso per il gruppo A. Nessuna divergenza host/parametro.

Insight policy chiave applicati:
- Body con incipit transazionale ("Conferma", "Riepilogo", "Attivazione")
- Riferimenti espliciti a dati transazionali (stabilimento, periodo, saldo)
- ZERO parole-trigger MARKETING ("Benvenuto", "Buona estate/spiaggia", celebrativi)
- Emoji limitate a ✅ 🏖️ ☀️ (escluse 🎉 💰 ✨ 🚀)
- Nessuna variabile in posizioni terminali di header/body

Strumento di invocazione mobile-friendly: la nuova sezione "WhatsApp Templates Tools"
nel `devboard.html` espone bottoni per invocare `create-utility-backup-templates`
e `check-template-status` direttamente da cellulare (dove Chrome non ha DevTools).

### Tentativo 7 (5 giugno 2026): doppio bugfix URL `?` mancante nel template recupero_password v3

**Sintomo 1 (reset password manager-driven)**: Matteo riceve regolarmente il
messaggio WA "Reset password per Universo" sul cellulare. Clicca il bottone
"Imposta nuova password" → si apre una pagina **404 page not found** sul
dominio `btnyzzpibedkslhtiizu.supabase.co`.

**Sintomo 2 (recupero password self-service)**: Matteo prova il flusso
"Password dimenticata?" dalla pagina login → inserisce telefono → riceve
messaggio WA. Clicca il bottone → **pagina bianca** (diverso sintomo dello
stesso bug di base, ma con URL ricomposto ancora più malformato).

**Diagnosi sintomo 1** (via long-press sul bottone WA + copia link):
URL del bottone effettivo:
```
https://btnyzzpibedkslhtiizu.supabase.co/auth/v1/verifytoken=1df0204e8b3882c3152fa3d9a95c3d614d6d0d54a5829b7cbc1dbb2f&type=recovery&redirect_to=https%3A%2F%2Fspiaggiamia.com%2F%3Freset%3D1
```
Manca il **`?`** tra `verify` e `token=...` (notare `verifytoken` attaccato).
Path inesistente su Supabase → 404.

**Root cause comune ai due sintomi**: il template Meta-approved
`spiaggiamia_recupero_password_v3` (SID `HX64ef2eb0...`) ha button URL
salvato/approvato come `https://btnyzzpibedkslhtiizu.supabase.co/auth/v1/verify{{4}}`
SENZA il `?` prima di `{{4}}`. Meta normalizza l'URL durante l'approval e
rimuove caratteri "speciali" come `?` tra path e variabile, oppure il `?` non
è mai stato salvato. La doc precedente assumeva il template avesse `verify?{{4}}`
(con `?`). I due codici client passavano la query string in modo SBAGLIATO ma
DIVERSO:
- `richiedi-reset-cliente`: passava la query string SENZA `?` iniziale
  (`recoveryUrl.search.slice(1)`) → URL ricomposto `verifytoken=...` → 404
- `recupero-password`: passava l'INTERO `recoveryLink` (URL completo) →
  URL ricomposto `verifyhttps://.../verify?token=...` (doppio schema/path)
  → pagina bianca

**Empiricamente confermato**: Meta NON URL-encoda `=` e `&` nel valore della
variabile (visibili in chiaro nell'URL del bottone), ma altera/rimuove altri
caratteri "speciali" come `?` nel template URL. Quindi non serve un short-link
o redesign — basta spostare il `?` da template a valore variabile.

**Fix 1** (commit `29c649e1` del 5 giu 2026 in `richiedi-reset-cliente/index.ts`):
```diff
-  const recoveryQuery = recoveryUrl.search.slice(1); // rimuove il '?' iniziale
+  const recoveryQuery = recoveryUrl.search; // include '?' iniziale (template ha "verify{{4}}" senza '?')
```
Deploy: `supabase functions deploy richiedi-reset-cliente`. Versione runtime: v12.

**Fix 2** (commit `69c66486` del 5 giu 2026 in `recupero-password/index.ts`):
```diff
+  const recoveryUrl = new URL(recoveryLink);
+  const recoveryQuery = recoveryUrl.search; // include '?' iniziale
   /* in body JSON.stringify */
-  link: recoveryLink, // passava URL COMPLETO
+  link: recoveryQuery, // passa solo query string con '?'
```
Deploy: `supabase functions deploy recupero-password`. Versione runtime: v10
(da v9).

**Lezioni**:
1. Quando si verifica il flusso WA end-to-end con button URL, **SEMPRE** fare
   long-press sul bottone in WhatsApp per copiare l'URL effettivo e
   confrontarlo con quello atteso. La doc del template (lato Twilio) può
   divergere dall'URL effettivamente approvato e renderizzato da Meta.
2. **Bug correlati in più edge function**: quando si trova un bug nell'invio
   WA per tipo `recupero_password`, controllare TUTTE le edge function che
   invocano `invia-whatsapp` con quel tipo. In questo caso sia
   `richiedi-reset-cliente` (manager-driven) sia `recupero-password`
   (self-service) condividevano la stessa root cause con manifestazioni
   diverse.

### Tentativo 8 (5 giugno 2026): aggiornamento profilo business via API + logo brand

**Razionale**: il profilo business WA è il "biglietto da visita" che il cliente
vede tappando il numero in chat. Compilato originariamente il 3 giu via Twilio
Console UI, ma con avatar di default ("S" arancione su sfondo grigio) e
categoria generica "Servizi locali". Per le demo a stabilimenti reali serve
qualcosa di più curato: logo brand SpiaggiaMia, descrizione completa,
categoria coerente (Travel and Transportation), email e sito web cliccabili.

**Asset brand creato** (commit `b7527413` del 4 giu 2026, h 22:41 UTC):
`assets/wa-profile-picture.jpg` (27.2 KB, 640×640 JPG). Design:
- Gradient verticale ocean: `#38bdf8` (sky light, top) → `#0ea5e9` (mid) →
  `#0369a1` (deep ocean, bottom)
- Ombrellone bianco centrale a 6 settori alternati bianco/giallo caldo
  (`#ffd750`), apice con pallina bianca, asta cilindrica bianca arrotondata
- Sole giallo caldo (`#ffc83c`) in alto a destra con halo sfumato (5 layer
  decrescenti)
- Nessun testo (illeggibile a 50px = dimensione avatar WhatsApp)
- Generato programmaticamente via Python+PIL (codice nella session 5 giu)

Servito da Vercel a `https://spiaggiamia.com/assets/wa-profile-picture.jpg`.

**Nuova Edge Function `manage-wa-business-profile`** (deployata 5 giu 2026,
3 iterazioni v1→v2→v3 per fix successivi):
- Modes `?mode=list|get|update`
- Twilio Senders API v2 endpoint `https://messaging.twilio.com/v2/Channels/Senders[/{SID}]`
- `verify_jwt=true` + check admin-only per `update`

**3 bugfix incontrati durante l'integrazione**:
1. **v1 → v2**: errore 20001 "Missing required parameter Channel in the query"
   sul `list`. Fix: aggiunto `&Channel=whatsapp` all'URL di list.
2. **v2 → v3**: errore "Forbidden: Caller anonymous" sull'update pur essendo
   loggato come admin. Fix: pattern `createClient + global.headers +
   getUser()` non funziona — fa firmare con anon key invece del JWT utente.
   Pattern corretto: estrarre il token dall'header Authorization e passarlo
   come argomento a `supa.auth.getUser(token)`.
3. **Payload v3 - shape websites/emails**: dal `get` osservato che `emails` e
   `websites` sono array di OGGETTI (`[{email,label}]`, `[{website,label}]`),
   NON array di stringhe come avevo inizialmente assunto.
4. **Payload v3 - vertical enum**: errore 63100 con valore `"TRAVEL"`. Twilio
   accetta solo le stringhe esatte dell'enum (case-sensitive con spazi).
   Lista completa: `Alcohol, Automotive, Beauty/Spa/Salon, Clothing and
   Apparel, Education, Entertainment, Event Planning and Service, Finance
   and Banking, Food and Grocery, Hotel and Lodging, Matrimony Service,
   Medical and Health, Non-profit, Online Gambling, OTC Drugs, Other,
   Physical Gambling, Professional Services, Public Service, Restaurant,
   Shopping and Retail, Travel and Transportation`.

**Update riuscito** (h 07:35 UTC del 5 giu 2026):
- Status response: HTTP 202 Accepted
- `response.status: "ONLINE:UPDATING"` → propagazione Meta in corso
- Tutti i 6 campi accettati: about, description, emails, websites, vertical,
  logo_url
- Sender SID Twilio confermato: `XE332bf468c429bee57ea725b7fe0afb13`

**Workflow per future modifiche del profilo**: aprire
`spiaggiamia.com/devboard.html` → sezione "👤 WhatsApp Business Profile" →
editare il textarea payload → "Update WA profile" → confermare popup. Niente
PowerShell o curl manuali.

**Limite display name nel header chat**: confermato 5 giu che il display name
"SpiaggiaMia" approvato lato Twilio non garantisce la visualizzazione come
header chat sul cell destinatario. Necessario salvare il numero come contatto
"SpiaggiaMia" sul dispositivo, oppure ottenere Official Business Account
(richiede business verification + P.IVA). Il logo brand nel profilo è invece
visibile sempre tappando il header del numero (azione naturale del destinatario
per "vedere chi è").

### Tentativo 9 (5 giugno 2026): bugfix frontend `doForgotPassword` — 401 gateway

**Sintomo**: dopo aver deployato il fix v10 di `recupero-password` (Tentativo 7,
Fix 2), Matteo prova il flusso self-service dal cellulare ("Password
dimenticata?" → inserisce telefono Matteo Posterli `+393299088725` → click).
**Nessun WhatsApp arriva**. UI mostra il messaggio generico previsto, ma
silenziosamente la chiamata fallisce.

**Diagnosi** (via `Supabase:get_logs` su edge-function):
```
POST | 401 | recupero-password v10 — 155ms
POST | 401 | recupero-password v9  — 615ms  (anche prima del fix Tentativo 7)
```
La function NON entra mai nel codice: 401 immediato dal gateway Supabase
(execution_time_ms 155-615ms = solo overhead di routing).

**Root cause**: il frontend in `js/auth.js` (funzione `doForgotPassword`)
chiamava `recupero-password` con fetch raw:
```javascript
const { data: { session } } = await sb.auth.getSession();
const headers = { 'Content-Type': 'application/json' };
if (session?.access_token) {
  headers['Authorization'] = `Bearer ${session.access_token}`;
}
await fetch(`${SUPABASE_URL}/functions/v1/recupero-password`, { ... });
```
Quando l'utente NON è loggato (caso tipico di "Password dimenticata?"),
`session` è `null`, l'header `Authorization` non viene aggiunto → gateway
Supabase risponde 401. Il commento nel codice ("la function accetta anon")
era errato: il gateway con `verify_jwt: true` richiede SEMPRE un JWT valido,
anche solo la anon key del progetto (non vuoto).

Confermato dal cliente cercato nel DB: Matteo Posterli con telefono
`+393299088725` è registrato (user_id != null), ha `whatsapp_consenso=true`,
appartiene a Universo (`wa_enabled=true`). Quindi tutti i pre-check sarebbero
passati se la function fosse stata invocata. Il fallimento era totalmente a
livello di gateway.

**Fix** (commit `def7f67b` del 5 giu 2026 in `js/auth.js`):
```diff
-  const { data: { session } } = await sb.auth.getSession();
-  const headers = { 'Content-Type': 'application/json' };
-  if (session?.access_token) {
-    headers['Authorization'] = `Bearer ${session.access_token}`;
-  }
-  try {
-    await fetch(`${SUPABASE_URL}/functions/v1/recupero-password`, {
-      method: 'POST',
-      headers,
-      body: JSON.stringify({ identificatore: tel, canale: 'telefono' }),
-    });
-  } catch (e) {
-    console.warn('recupero-password fetch error', e);
-  }
+  try {
+    const { error: invokeErr } = await sb.functions.invoke('recupero-password', {
+      body: { identificatore: tel, canale: 'telefono' },
+    });
+    if (invokeErr) console.warn('recupero-password invoke error', invokeErr);
+  } catch (e) {
+    console.warn('recupero-password invoke exception', e);
+  }
```

`sb.functions.invoke()` gestisce automaticamente l'`Authorization`:
- Se l'utente è loggato: usa `session.access_token`
- Se NO: ricade sulla anon key con cui `sb` è stato istanziato

**Niente deploy edge function necessario**: fix puramente frontend. Da
aggiornare il cache buster `?v=...` in `index.html` per `js/auth.js` per
forzare il refresh sui client. Pre-fix cache buster: `?v=20260603i`.

**Lezione**: quando un flusso "fire-and-forget" fallisce silenziosamente,
NON fidarsi solo dell'UX di risposta generica. Controllare SEMPRE i log
edge-function (`Supabase:get_logs` MCP) per vedere se la function è stata
effettivamente raggiunta. Un 401 col 155ms di execution time è una signature
classica di rifiuto a livello di gateway, prima dell'invocazione del codice.

## 8. Fase 3 — Reset password manager-driven

Completata in main il 3 giu 2026. PR #104 + #105 + #106 + commit standalone.
Bugfix URL aggiunto il 5 giu 2026 (vedi Tentativo 7 sezione 7).

- Frontend: menu ⋮ contestuale al posto di "[Invita]" in tabella Ombrelloni/Clienti
- 6 azioni: copia link, invito email/WA, rigenera link, reset email/WA
- Bulk modale unificato: accetta selezione mista (registrati + non-registrati),
  auto-split INVITO vs RESET con badge colorati
- Backend: Edge Function `richiedi-reset-cliente` (manager-driven con
  ownership check + bugfix URL `?` mancante 5 giu)
- Esteso `invia-email` con tipo `reset_password` (template HTML + CTA)

Test reset password via **email**: ✅ funziona end-to-end (testato cliente
Matteo Posterli ombrellone 100, email reale).

Test reset password via **WhatsApp** (manager-driven, `richiedi-reset-cliente`):
✅ funziona end-to-end post-bugfix del 5 giu 2026 (template approvato Meta +
URL ricomposto correttamente).

Test recupero password via **WhatsApp** (self-service, `recupero-password`):
✅ atteso funzionante post-fix Tentativo 9 (frontend `sb.functions.invoke`)
del 5 giu 2026 + cache buster aggiornato.

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
- [x] **richiedi-reset-cliente Edge Function** — v12 (post-bugfix 5 giu 2026)
- [x] **recupero-password Edge Function** — v10 (post-bugfix 5 giu 2026)
- [x] **Profilo WhatsApp Business completo** — descrizione, indirizzo, email, sito
- [x] **Logo brand SpiaggiaMia** — `assets/wa-profile-picture.jpg` (commit `b7527413`)
- [x] **Edge Function `manage-wa-business-profile`** — v3 ACTIVE (5 giu 2026)
- [x] **DevBoard sezione "WhatsApp Business Profile"** — Get/List/Update con payload editabile (5 giu 2026)
- [x] **Update profilo business via API** — completato 5 giu 2026 h 07:35 UTC (about, description, emails, websites, vertical "Travel and Transportation", logo_url)
- [x] **Recupero password v1 sottomesso** — rejected per "variables at start/end"
- [x] **Recupero password v3 sottomesso e approvato Meta** — 5 giu 2026 (categoria UTILITY)
- [x] **WA_SID_RECUPERO settato su Supabase Secrets** (`HX64ef2eb0...`)
- [x] **Edge Function check-template-status** (read-only) — 4 giu 2026
- [x] **Edge Function recreate-whatsapp-templates** — 4 giu 2026
- [x] **Ricreazione template stagionali** — 4 giu 2026
- [x] **Secret Supabase aggiornati con nuovi SID** — `WA_SID_INVITO`, `WA_SID_BENVENUTO`, `WA_SID_SUBAFFITTO` (4 giu 2026)
- [x] **Verifica passaggio a pending Meta** — i 3 stagionali in pending ~13min dopo ricreazione (4 giu h 16:54 UTC)
- [x] **Appeal categoria sottomesso per i 3 stagionali** — via Meta WhatsApp Manager / Aggiornamenti categoria modelli (4 giu 2026 h ~17:20 UTC)
- [x] **Bugfix URL `?` mancante in richiedi-reset-cliente** — commit `29c649e1` del 5 giu 2026, deploy v12
- [x] **Bugfix URL `?` mancante in recupero-password (self-service)** — commit `69c66486` del 5 giu 2026, deploy v10
- [x] **Bugfix frontend `doForgotPassword` (401 gateway)** — commit `def7f67b` del 5 giu 2026 (sostituita fetch raw con sb.functions.invoke)
- [ ] **Cache buster `?v=20260605...` in index.html per js/auth.js** — da fare via Claude Code (file grande, non MCP)
- [x] **Test end-to-end WA reset password (manager-driven)** sul cellulare — ✅ funzionante post-bugfix
- [ ] **Test end-to-end WA recupero password (self-service)** sul cellulare — atteso ✅ post-fix Tentativo 9 + cache buster
- [ ] **Verifica visiva logo brand** sul cellulare destinatario (tappare header numero) — attendere propagazione `ONLINE:UPDATING` → `ONLINE` (1-5 min dal 5 giu h 07:35 UTC)
- [ ] **Esito appeal categoria 3 stagionali** — atteso 24-72h (Ripristinati = UTILITY ✅ o Invariati = MARKETING). Se Invariati, valutare modifica body.
- [x] **Edge Function `create-utility-backup-templates`** — deployata 4 giu 2026 v1 ACTIVE
- [x] **9 template UTILITY backup creati e submittati** — 4 giu 2026 h 21:36 UTC, output `summary.ok=9 failed=0`, tutti `received`. SID popolati in sezione 4.
- [x] **DevBoard mobile-friendly per invocazioni admin** — aggiunta sezione "WhatsApp Templates Tools" in `devboard.html` (4 giu 2026) + sezione "WhatsApp Business Profile" (5 giu 2026)
- [ ] **Esito approval Meta per i 9 backup** — atteso 24-72h
- [ ] **Aggiornamento `invia-whatsapp` per nuove signature A/B/C** — solo se si swappano
- [ ] **Approvazione Meta business-initiated dei 3 template invito/benvenuto/subaffitto** (status: pending, ricreati 4 giu)
- [ ] **Business verification Meta** — bloccata da mancanza P.IVA (long term).
      Sbloccherebbe Official Business Account → display name "SpiaggiaMia"
      sempre prominente nel header chat (oggi visibile solo tappando il numero)

## 10. Come riprendere il test (quando Meta approva)

**Per i 3 template invito/benvenuto/subaffitto** (ancora pending):
nessun cambio codice necessario, Edge Functions già pronte e secret aggiornati →
al primo evento (invito/benvenuto/subaffitto) i WA dovrebbero partire
automaticamente. ⚠️ Categoria al momento: MARKETING (con appeal in corso del 4
giu). Se l'appeal viene accolto, diventa UTILITY automaticamente — nessuna
azione richiesta lato codice.

**Se l'appeal categoria del 4 giu è "Invariati" (rigettato)**: valutare
modifica body con prefisso `"Notifica automatica: [tipo evento]\n\n"` in testa,
poi re-submission. Il SID resta invariato, quindi i secret Supabase non vanno
toccati. In alternativa, accettare il costo MARKETING per i primi mesi.

**Alternativa migliore**: swap dei secret WA_SID_* ai SID dei 9 backup
(sezione 4 sotto-sezione "Template UTILITY backup"). Richiede update
`invia-whatsapp` per le nuove signature (1 variabile in più su B/C).

**Verifica delivery reale**: dopo qualsiasi test WA, controlla Meta Business
Manager → WhatsApp Manager → Numeri di telefono → click sul numero → tab
Insights → "Tutti i messaggi" → deve aumentare "Messaggi inviati" e
"Messaggi consegnati" (NON solo "ricevuti"). Se restano a 0, Meta ha
bloccato il template. Se aumentano, è arrivato.

**⚠️ Test button URL**: sempre fare long-press sul bottone WA per copiare
l'URL effettivo, e verificare che corrisponda al pattern atteso. Meta può
normalizzare l'URL durante l'approval rimuovendo caratteri speciali (vedi
bugfix `?` del 5 giu 2026 in sezione 7 - Tentativo 7).

**⚠️ Test fire-and-forget**: quando un flusso ritorna sempre risposta
generica (es. "Password dimenticata?" anti-enumeration), NON fidarsi
dell'UX. Controllare i log della edge function con
`Supabase:get_logs` per verificare che la function sia stata effettivamente
raggiunta (status 200) e non rifiutata dal gateway con 401 (vedi
Tentativo 9 sezione 7 — execution_time_ms 155-615ms = rifiuto gateway).

**Verifica visiva profilo business**: tappare il header del numero
`+393520426199` nella chat WhatsApp dal destinatario. Dovrebbero comparire:
logo ombrellone SpiaggiaMia (avatar), nome "SpiaggiaMia", about ("Stagione in
spiaggia, organizzata."), description completa, email e sito cliccabili,
categoria "Travel & Transportation". Se vedi ancora l'avatar di default
("S" arancione) o categoria "Servizi locali", attendere ancora qualche minuto
per propagazione `ONLINE:UPDATING` → `ONLINE` (verificare con
`?mode=get` dal devboard).

## 11. Per nuove sessioni Claude

Leggi questo file con `get_file_contents` per orientarti. Punti chiave:
- Tutta l'infrastruttura tecnica è in main e in produzione
- Edge functions deployate: `invia-whatsapp` v10, `richiedi-reset-cliente` v12
  (post-bugfix 5 giu), `recupero-password` v10 (post-bugfix 5 giu),
  `check-template-status` v8, `recreate-whatsapp-templates`,
  `create-utility-backup-templates`, `manage-wa-business-profile` v3
- **Tutti i flussi password via WhatsApp: ✅ FUNZIONANTI end-to-end**
  (post-bugfix 5 giu: 2 backend + 1 frontend)
- **Profilo business WA aggiornato via API 5 giu** con logo brand SpiaggiaMia
- Restano open solo:
  - approval Meta dei 3 template stagionali (asincrona, fuori controllo)
  - esito appeal categoria UTILITY dei 3 stagionali (24-72h da 4 giu)
  - approval Meta dei 9 template UTILITY backup
- Set di 9 template UTILITY backup disponibile da 4 giu 2026 h 21:36 UTC. SID
  popolati in sezione 4. Se l'appeal dei 3 stagionali viene respinto, swap dei
  secret WA_SID_* ai SID di accesso_*/registrazione_*/operazione_* (richiede
  update di invia-whatsapp per le variabili bottone aggiuntive su A/B/C).
- DevBoard mobile-friendly: `spiaggiamia.com/devboard.html` ha 2 sezioni admin:
  - "💬 WhatsApp Templates Tools" per `create-utility-backup-templates` e
    `check-template-status`
  - "👤 WhatsApp Business Profile" per `manage-wa-business-profile`
    (Get/List/Update profilo)

Verifica status template:
- Edge Function `check-template-status` (read-only, da console browser loggato
  manager: `sb.functions.invoke('check-template-status')`) — modo più rapido
- https://console.twilio.com/us1/develop/sms/content-template-builder
- https://business.facebook.com/latest/whatsapp_manager/message_templates
- Cerca i template `spiaggiamia_*`
- Status Twilio: `unsubmitted → received → pending → approved/rejected`
  (`received` = Twilio ce l'ha ma non l'ha ancora inoltrato a Meta;
  `pending` = già a Meta in review)
- Per esito appeal categoria: Meta Business Manager → SpiaggiaMia → Account
  WhatsApp → Aggiornamenti categoria modelli → tab "Ripristinati" o "Invariati"

Verifica profilo business:
- Edge Function `manage-wa-business-profile?mode=get` (default mode) — ritorna
  profilo completo con status (`ONLINE`/`ONLINE:UPDATING`), tutti i campi
  attualmente impostati, sender SID Twilio, WABA ID. Sender SID atteso:
  `XE332bf468c429bee57ea725b7fe0afb13`.
- Dal cellulare destinatario: aprire chat con `+393520426199`, tappare header
  numero → si apre profilo business con logo brand + descrizione + sito + email

Debug 401/403 inattesi:
- `Supabase:get_logs` con service `edge-function` mostra status code e
  execution_time_ms. Un 401 con ~150-600ms = rifiuto al gateway (manca/non
  valido il JWT). Un 403 dentro il codice = check di ownership/admin fallito.
- Frontend deve sempre chiamare le edge function via `sb.functions.invoke()`
  per garantire l'`Authorization` automatico (anon key se non loggato).

## 12. UUID stabilimenti (riferimento)

| Nome | UUID | wa_enabled |
|------|------|------------|
| Universo (test in corso) | `2c82f99e-992e-4935-9aa7-9d0bd94d9799` | true |
| dede | `5f0cf433-eaf7-4b8b-9da6-a87d972abdda` | false |

## 13. Clienti di test pilota

| Nome | Ombrellone | Telefono | WA consenso | Note |
|------|------------|----------|-------------|------|
| Matteo Posterli | 100 | +393299088725 | true | Registrato, email reale |
| Nicola Rizzo | 104 | +393339876543 | true | Registrato, email sintetica |
| Andrea Lombardi | 105 | +393299088725 | true | Non registrato |

⚠️ **Duplicati telefono `+393299088725`** (verificato 5 giu via SQL): in DB
ci sono 4 record con questo telefono allo stabilimento Universo:
1. Riccardo Marino — non registrato
2. Andrea Lombardi — non registrato
3. Matteo Posterli — REGISTRATO ✅ (è quello che matcha il filtro
   `.not("user_id", "is", null)` in `recupero-password`)
4. Matteo Posterli duplicato — non registrato

Da pulire prima dei demo reali per evitare ambiguità ai test.
