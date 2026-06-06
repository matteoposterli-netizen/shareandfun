# SpiaggiaMia — Integrazione notifiche WhatsApp (stato e piano)

Documento di riferimento per la knowledge base del progetto.
Ultimo aggiornamento: 5 giugno 2026 — applicate preventivamente le lezioni
della saga (Tentativi 7-12) agli altri 3 flussi WA non ancora testati
(invito, benvenuto, subaffitto_confermato). Vedi Tentativo 13 sezione 7.
Flusso "Password dimenticata?" via WhatsApp FUNZIONANTE end-to-end. Root
cause finale: nuove chiavi Supabase `sb_publishable_*` / `sb_secret_*`
non-JWT incompatibili con `verify_jwt=true` al gateway delle Edge Function.

## STATO ATTUALE (TL;DR)

**Tutti i flussi password via WhatsApp: FUNZIONANTI end-to-end (5 giu 2026).**
Il template `spiaggiamia_recupero_password_v3` è stato approvato da Meta tra il
4 e il 5 giugno, il messaggio arriva correttamente sul cellulare. **Saga di 4
bugfix in cascata risolta il 5 giu** (Tentativi 7, 9, 11, 12 — vedi sezione 7):
- T7: URL `?` mancante nel template Meta-approved (backend
  `richiedi-reset-cliente` + `recupero-password`)
- T9: frontend `doForgotPassword` non passava Authorization (401 gateway)
- T11: `verify_jwt=false` per `recupero-password` (chiave `sb_publishable_*`
  non-JWT non passa il gateway)
- T12: `verify_jwt=false` + security guard per `invia-whatsapp` (stesso
  bug ma per la chiamata server-to-server con `sb_secret_*`)

Restano in attesa di approval Meta i 3 template stagionali
(invito/benvenuto/subaffitto) e i 9 template UTILITY backup.

**Profilo business WhatsApp COMPLETO (5 giu 2026):** description, about,
vertical "Travel and Transportation", email, sito web settati via API Twilio
(Edge Function `manage-wa-business-profile`); logo brand SpiaggiaMia
(ombrellone giallo/bianco su gradient ocean) caricato via Meta Business
Manager UI dopo che il `logo_url` via API non era stato propagato
silenziosamente da Twilio→Meta. Vedi sezione 7 - Tentativi 8 e 10.

- ✅ Frontend → Edge Function → Twilio: catena verificata in produzione
- ✅ Twilio Sender `+393520426199` ONLINE, display name "SpiaggiaMia"
- ✅ **Profilo WhatsApp Business completo con logo brand** — 5 giu 2026
  (hybrid: API per i campi testuali, UI Meta per la foto profilo)
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

- **Edge Function `invia-whatsapp`** (v18 al 5 giu 2026, post-Tentativo 12):
  - Credenziali e Content SID **da env var** (Supabase secrets), niente tabella DB
  - **verify_jwt=false** lato gateway (config.toml). Sicurezza nel codice:
    string-equality con SUPABASE_SERVICE_KEY env (formato-agnostic),
    `getUser(jwt)` per user-JWT, guard 401 esplicito per anonimi
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
- **Edge Function `recupero-password`** (v11 al 5 giu 2026, post-Tentativo 11):
  - Solo ramo telefono (ramo email gestito client-side via
    `supabase.auth.resetPasswordForEmail()`)
  - Risponde sempre `{ ok: true }` per evitare enumeration attack
  - Trova cliente registrato → genera recovery link via Admin API → chiama
    `invia-whatsapp` con SERVICE_KEY (server-to-server) e tipo `recupero_password`
  - **Stesso pattern URL del manager-driven**: estrae `recoveryUrl.search` (con
    `?` iniziale) e lo passa come variabile `link` → `invia-whatsapp` lo
    inoltra come `{{4}}` al template Twilio. Il template ricompone l'URL
    Supabase corretto.
  - **verify_jwt=false** lato gateway (config.toml). Necessario perché la
    chiave del client `sb_publishable_*` non è JWT e il gateway con
    verify_jwt=true la rifiuta sempre. Sicurezza nel codice: risposta
    sempre generica anti-enumeration + SERVICE_KEY per Admin API.
- **Edge Function `manage-wa-business-profile`** (creata 5 giu 2026, v3 ACTIVE):
  - Gestisce il profilo business WhatsApp via **Twilio Senders API v2**
    (`https://messaging.twilio.com/v2/Channels/Senders`)
  - Modes (query param `?mode=...`):
    - `list` — elenca tutti i sender disponibili (debug). **Query Twilio
      richiede `&Channel=whatsapp`** obbligatorio (errore 20001 senza)
    - `get` (default) — auto-detect del sender WA per `+393520426199`,
      ritorna profilo attuale, status (`ONLINE`/`ONLINE:UPDATING`), webhook,
      configuration, WABA ID. ⚠️ **Limite noto**: il `get` può ritornare
      profilo vuoto anche quando i campi sono effettivamente settati lato
      Meta (cache stantia o endpoint immaturo della Twilio Senders API v2).
      Verifica autoritativa sempre dal cellulare destinatario tappando il
      header del numero, oppure da Meta Business Manager → WhatsApp Manager.
    - `update` — aggiorna campi profilo (about/address/description/emails/
      websites/vertical/logo_url/banner_url). Solo admin (check email caller).
      Body JSON con chiave `profile`. ⚠️ **`logo_url` non affidabile**: vedi
      Tentativo 10 sezione 7 — per la foto profilo usare la UI Meta diretta.
  - **verify_jwt=true**. Per `update`, controllo aggiuntivo: estrae il token
    dall'header Authorization e lo passa direttamente a `supa.auth.getUser(token)`.
    ⚠️ Pattern noto: il pattern alternativo `createClient(URL, KEY, { global:
    { headers: { Authorization } } })` + `supa.auth.getUser()` NON funziona —
    fa firmare con l'anon key invece del JWT utente, ritornando `null`. È
    successo in v1 della function: il caller risultava "anonymous" pur essendo
    loggato. Fix in v3.
- **Helper frontend** `inviaWhatsapp(tipo, params, stab)` in `js/utils.js`
  (post-T13 5 giu 2026 sera): usa `sb.functions.invoke('invia-whatsapp')`
  invece di fetch raw. Early-return `no_session` esplicito. Garantisce
  che l'Authorization sia sempre presente quando la session esiste,
  evitando bug latenti del tipo T9.
- **Helper frontend** `inviaEmail(tipo, clienteData, stab, override)` in
  `js/utils.js` (post-T13 5 giu 2026 sera): stesso pattern di
  inviaWhatsapp. Sostituita fetch raw con `sb.functions.invoke('invia-email')`
  + early-return `no_session`.
- **Helper frontend** `richiediResetCliente(clienteId, canale)` in
  `js/utils.js`: invariato. Mantiene fetch raw ma con guard `no_session`
  esplicito sin dall'origine (equivalente al pattern post-T9 a livello
  funzionale).
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
- **Edge Function `recreate-whatsapp-templates`** (creata 4 giu 2026): delete +
  recreate identico + submit per i 3 template stagionali quando bloccati in
  `received` lato Twilio. verify_jwt=true.
- **Edge Function `create-utility-backup-templates`** (creata 4 giu 2026):
  crea e sottomette 9 template UTILITY backup. verify_jwt=true.
- **Asset brand** `assets/wa-profile-picture.jpg` (commit `b7527413`, 27.2 KB,
  640×640 JPG): logo SpiaggiaMia per WA. v4 1080×1080 fuori-repo per upload
  Meta UI (Tentativo 10).
- **DevBoard mobile-friendly** `devboard.html`: sezioni admin per gestione
  WA da cellulare (auth: solo matteo.posterli@gmail.com).

## 4. Template Twilio (Content SID definitivi)

Lingua **Italian**. Categoria sottoposta **UTILITY** in tutti i casi, ma Meta ha
auto-riclassificato i 3 stagionali a **MARKETING** al passaggio in pending.
Il `recupero_password_v3` è rimasto UTILITY (contenuto chiaramente transazionale).
**Appeal categoria sottomesso il 4 giu 2026 per i 3 stagionali**.

1. **`spiaggiamia_invito_stagionale`** — SID `HXcf66089cb849dfcd69bfec8bd5dffe71`
   (ricreato 4 giu 2026)
   - Call To Action con bottone URL
   - Variabili body: 1=nome, 2=stabilimento
   - Bottone URL dinamico: token invito (chiave `button_1_url_0`)
   - URL pattern verificato 4 giu h 21:36 UTC: `https://spiaggiamia.com/?invito={{3}}`
   - Status approval: 🟡 **pending** (verificato 4 giu h 16:54 UTC)
   - Categoria assegnata da Meta: **MARKETING** (sottomesso come UTILITY).
   - 🔄 **Appeal categoria sottomesso 4 giu** — esito atteso 24-72h.

2. **`spiaggiamia_benvenuto_stagionale`** — SID `HXf3231107ecd0bf19e6737cdc53dfd0d7`
   (ricreato 4 giu 2026)
   - Text
   - Variabili: 1=nome, 2=stabilimento
   - Status approval: 🟡 **pending** (4 giu h 16:54 UTC)
   - Categoria: **MARKETING**. 🔄 Appeal in corso.

3. **`spiaggiamia_subaffitto_confermato`** — SID `HX08068906ff6ec2ee2286405506accd6a`
   (ricreato 4 giu 2026)
   - Text
   - Variabili: 1=nome, 2=periodo, 3=credito guadagnato, 4=credito totale, 5=stabilimento
   - Status approval: 🟡 **pending** (4 giu h 16:54 UTC)
   - Categoria: **MARKETING**. 🔄 Appeal in corso.

4. **`spiaggiamia_recupero_password`** (v1) — SID `HXe0b44b18fae266c18cabe3973a5f708f`
   - Call To Action con bottone URL
   - Status Meta: ❌ **REJECTED** il 3 giu 2026 per "Variables can't be at the start or end of the template"
   - Stato: cancellato da Twilio, sostituito dal v2 (poi v3)

5. **`spiaggiamia_recupero_password_v2`** — superato dal v3, non più presente su Twilio

6. **`spiaggiamia_recupero_password_v3`** — SID `HX64ef2eb0f7aa4497e97963116ea8b2f2`
   (creato il 3 giu 2026)
   - Call To Action con bottone URL
   - Body con testo statico alla fine (no variabili in posizione terminale)
   - Variabili body: 1=stabilimento (intro), 2=nome cliente, 3=stabilimento (body)
   - Button URL **APPROVED**: `https://btnyzzpibedkslhtiizu.supabase.co/auth/v1/verify{{4}}`
     **(SENZA `?` tra `verify` e `{{4}}`)**. Meta ha rimosso/normalizzato
     il `?` durante l'approval. La variabile {{4}} DEVE iniziare con `?`
     per ricomporre l'URL corretto. Vedi Tentativo 7.
   - Variabile {{4}}: la query string COMPLETA del recovery link Supabase,
     incluso `?` iniziale (`?token=...&type=recovery&redirect_to=...`).
   - Status: ✅ **APPROVED** Meta (5 giu 2026)
   - Categoria: **UTILITY**

### Template UTILITY backup (creati 4 giugno 2026 h 21:36 UTC)
Set di 9 template di backup creati per offrire un'alternativa ai 3 template stagionali
attualmente in appeal MARKETING. Tutti sottoposti come UTILITY con
`allow_category_change: true`.

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

**Quando swappare**: se appeal categoria dei 3 attuali "stagionali" viene respinto:
- WA_SID_INVITO = <SID accesso_*>
- WA_SID_BENVENUTO = <SID registrazione_*>
- WA_SID_SUBAFFITTO = <SID operazione_*>

⚠️ **Cambio signature variabili**: invia-whatsapp v18 deve essere aggiornato per
passare variabili bottone aggiuntive ({{3}} per accesso/registrazione, {{6}}
per operazione). Open item prima dello swap.

## 5. Numero pilota: BYON eSIM Iliad

- Numero **`+393520426199`**, dedicato a SpiaggiaMia
- Account Twilio paid (Active)
- Sender ONLINE con display name "SpiaggiaMia" approvato
- Sender SID Twilio: `XE332bf468c429bee57ea725b7fe0afb13`
- Twilio WABA ID: 1658468622079031
- Meta Business Manager ID: 982498484190082
- Profilo business compilato 3 giu via Twilio Console, **ricompilato via API
  5 giu 2026** con: about, description, emails, websites,
  vertical "Travel and Transportation"
- **Logo brand caricato via Meta Business Manager UI (5 giu 2026)** —
  workaround per `logo_url` API non propagato (Tentativo 10)
- Display name "SpiaggiaMia" approvato lato Twilio ma non sempre visibile come
  header chat. Per OBA serve business verification + P.IVA.

## 6. Vincoli Meta

- **250 conversazioni business-initiated / 24h** finché business verification
  Meta non è completata
- **Business verification**: NON procedibile per persone fisiche senza P.IVA.
- **Categoria template auto-classificata da Meta**: anche se sottoponi un template
  come UTILITY, Meta può riclassificarlo a MARKETING (vedi 3 stagionali).
- ⚠️ **Normalizzazione URL del button**: Meta può rimuovere `?` tra path e
  `{{variabile}}` durante l'approval. Soluzione: includere il `?` nel valore
  della variabile. `=` e `&` invece sono preservati.
- **Workflow appeal categoria** (testato 4 giu): Meta Business Manager →
  Aggiornamenti categoria modelli → tab "Available for review" → "Richiedi
  revisione". Nessuna motivazione testuale richiesta. Esito atteso 24-72h.
- **Shape vincoli Twilio Senders API**: `/v2/Channels/Senders` (list) richiede
  `Channel=whatsapp` obbligatorio. `emails`/`websites` sono array di OGGETTI
  `[{email,label}]`/`[{website,label}]`. `vertical` enum case-sensitive con
  spazi. Update response 202 + `status: "ONLINE:UPDATING"`. `logo_url`
  non propagato affidabilmente — usa Meta UI (Tentativo 10).

## 7. Storia delle iterazioni di approval

### Tentativo 1 (giugno 2026): submission iniziale
3 template sottomessi come Utility, accettati come user-initiated immediatamente.
Tutti pending come business-initiated.

### Tentativo 2 (3 giugno 2026): recupero_password v1
**Rejected** con motivo "Variables can't be at the start or end of the template".

### Tentativo 3 (3 giugno 2026): recupero_password v2
Sottomesso con body fixato.

### Ticket Twilio Support (3 giugno 2026)
Aperto per template pending Meta da >48h.

### Tentativo 4 (4 giugno 2026): ricreazione stagionali
Verificato che i 3 template stagionali non erano mai stati inoltrati da Twilio
a Meta. Ricreati identici via Edge Function `recreate-whatsapp-templates`.
Passati a `pending` entro ~13 minuti. ⚠️ Meta auto-riclassificati a MARKETING.

### Tentativo 5 (4 giugno 2026): appeal categoria stagionali
Sottomesso appeal via Meta Business Manager. NON è richiesta motivazione
testuale. Esito atteso 24-72h.

### Tentativo 6 (4 giugno 2026 h 21:36 UTC): set di 9 template UTILITY backup
Creato il set parallelo via `create-utility-backup-templates`. Pre-step
verification del pattern URL invito. Insight policy chiave applicati (zero
parole-trigger MARKETING, emoji limitate, etc.).

### Tentativo 7 (5 giugno 2026): doppio bugfix URL `?` mancante nel template recupero_password v3

**Sintomi**: 1) reset manager-driven → bottone WA porta a 404; 2) recupero
self-service → pagina bianca. Root cause comune: template approvato senza `?`
tra `verify` e `{{4}}` (Meta lo ha rimosso). I due codici client passavano
la query string in modo SBAGLIATO ma DIVERSO.

**Fix 1** (`29c649e1` in `richiedi-reset-cliente/index.ts`): include '?' iniziale
nella query string. Deploy v12.

**Fix 2** (`69c66486` in `recupero-password/index.ts`): passa solo query string
con '?' invece dell'intero recoveryLink. Deploy v10.

**Lezioni**: 1) long-press sul bottone WA per copiare l'URL effettivo,
confrontare con quello atteso. 2) bug correlati in più edge function — controllare
TUTTE quelle che invocano lo stesso tipo.

### Tentativo 8 (5 giugno 2026): aggiornamento profilo business via API + logo brand

Asset brand creato (`b7527413`, 640×640 JPG ocean+ombrellone). Nuova Edge
Function `manage-wa-business-profile` deployata (v1→v2→v3). 3 bugfix
incontrati: Channel param richiesto, JWT auth pattern, payload shape.
Update riuscito h 07:35 UTC. ⚠️ `GET` può ritornare profilo vuoto pur essendo
popolato lato Meta (cache Twilio v2). Source of truth = WhatsApp client.

### Tentativo 9 (5 giugno 2026): bugfix frontend `doForgotPassword` — 401 gateway

**Sintomo**: dopo fix Tentativo 7, gli smoke test continuavano a non ricevere WA.

**Diagnosi**: log MCP edge-function mostravano 401 con execution_time_ms
~155-615ms — rifiuto al gateway. Il frontend in `js/auth.js` (`doForgotPassword`)
chiamava `recupero-password` con fetch raw + Authorization solo se session
esiste. Utente non loggato → no Authorization → gateway 401.

**Fix** (`def7f67b`): sostituita fetch raw con `sb.functions.invoke()`.
`sb.functions.invoke()` gestisce auto l'Authorization (session se loggato,
anon key altrimenti).

Cache buster (`048515a3`): aggiornato `js/auth.js?v=20260605a` in index.html.

**NOTA**: questo fix da solo NON era sufficiente — vedi Tentativo 11.

### Tentativo 10 (5 giugno 2026): logo brand caricato via Meta UI (workaround `logo_url` non propagato)

**Sintomo**: dopo update API Tentativo 8, tutti i campi testuali in Meta
correttamente, MA logo brand permaneva avatar default ("S" arancione).
`logo_url` accettato con echo nel response (202) ma non propagato a Meta.

**Workaround**: upload diretto via Meta Business Manager UI. Vincolo formato:
JPEG vero (no WebP). Chrome Android converte automaticamente `.jpg` → `.webp`
quando scarica da URL. Soluzione: rigenerato logo v4 1080×1080 JPEG vero via
Python+PIL, file scaricabile diretto. Upload riuscito al primo tentativo.

**Lezione**: quando API multi-vendor accetta payload con HTTP 200/202 ma
senza feedback downstream, NON fidarsi del response. Verificare sempre sul
vendor finale tramite UI o canale separato.

### Tentativo 11 (5 giugno 2026): `verify_jwt=false` per `recupero-password`

**Sintomo**: dopo fix T9 + cache buster, smoke test ancora ritornavano 401
al gateway (execution_time_ms ~90-150ms = rifiuto gateway-level).

**Diagnosi**: `js/state.js` istanzia client supabase con NUOVA chiave
pubblicabile `sb_publishable_7MGsfC7Pl9UAj76IphFMrw_Qk1II-DT`. Le nuove chiavi
Supabase (`sb_publishable_*` / `sb_secret_*`) introdotte post-2024 NON sono
JWT. Il gateway con `verify_jwt=true` tenta di parsarle come JWT firmati →
fallisce SEMPRE → 401.

**Conferma doc Supabase**:
> "The new API keys are not JWTs. Edge Functions only support JWT verification
>  via the anon and service_role JWT-based API keys."

**Fix** (`141d2832` in `config.toml`):
```toml
[functions.recupero-password]
verify_jwt = false
```

Sicurezza preservata dal codice: risposta sempre generica anti-enumeration,
lookup ristretto a clienti registrati, SERVICE_KEY per Admin API.

**Redeploy**: v11 confermato. POST 200 in ~1843ms (entra nel codice).

**Lezione**: prima di abilitare verify_jwt=true su una function pubblicamente
chiamabile, verificare il formato della chiave del client (JWT legacy `eyJ...`
o nuova `sb_publishable_*`). Nel secondo caso verify_jwt è incompatibile.

### Tentativo 12 (5 giugno 2026): `verify_jwt=false` + security guard per `invia-whatsapp`

**Sintomo**: dopo T11, recupero-password 200 OK in ~1843ms (entra nel codice),
generateLink success nei log auth, MA invia-whatsapp non appariva nei log.

**Diagnosi**: log Dashboard di `recupero-password` (NON il MCP get_logs che
mostra solo HTTP access) hanno rivelato:
```
ERROR  recupero-password WA invio fallito
       { code: "UNAUTHORIZED_INVALID_JWT_FORMAT", message: "Invalid JWT" }
```

Stesso identico bug di T11 ma per invia-whatsapp: recupero-password chiama
invia-whatsapp passando `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
ed env var contiene chiave `sb_secret_*` (NON JWT). Gateway con verify_jwt=true
respinge.

**Fix in due parti**:

**1. Security guard nel codice** (`2be6242f` in invia-whatsapp/index.ts):
```typescript
if (!isServiceRole && !callerUserId) {
  return jsonResponse({ error: "Autenticazione richiesta" }, 401);
}
```

Logica conservata: isServiceRole (string equality formato-agnostic) + user JWT
validato via getUser() + guard 401 esplicito per anonimi + ownership check
per tipo recupero_password.

**2. Disabilita verify_jwt** (`cccb6409`):
```toml
[functions.invia-whatsapp]
verify_jwt = false
```

**Redeploy**: invia-whatsapp v18.

Tutti i flussi esistenti continuano a funzionare:
- richiedi-reset-cliente (manager-driven): user-JWT → getUser → ownership ✅
- inviaWhatsapp da frontend loggato: session.access_token → getUser ✅
- recupero-password (server-to-server): SUPABASE_SERVICE_ROLE_KEY → isServiceRole ✅
- Anonimo: guard 401 ✅

**Post-deploy: WA ARRIVA SUL CELLULARE.** Saga del 5 giu chiusa.

**Lezione architetturale**: in un progetto migrato alle nuove chiavi Supabase
(`sb_publishable_*` / `sb_secret_*`), `verify_jwt=true` funziona SOLO se la
function è chiamata esclusivamente con user-JWT validi. Qualsiasi function
che riceve chiamate da utenti non loggati con publishable key OPPURE
server-to-server con SERVICE_ROLE_KEY DEVE avere `verify_jwt=false` +
autorizzazione gestita nel codice.

**Pattern di diagnosi gateway-vs-codice**:
- 401 con `execution_time_ms` ~90-200ms: rifiuto al gateway PRIMA del
  codice. Causa probabile: `verify_jwt=true` + chiave non-JWT.
- 401 con `execution_time_ms` >500ms: ha eseguito il codice, l'auth
  è fallita dentro. Causa probabile: ownership check o getUser fallito.
- 200 ma niente log downstream del fetch successivo: chiamata uscente
  rifiutata dal gateway downstream. Verifica nei log Dashboard
  (`console.error`), non solo nei log MCP HTTP access.

### Tentativo 13 (5 giugno 2026 sera): applicazione preventiva lezioni T7/T9/T11/T12 agli altri 3 flussi WA

**Contesto**: chiusa la saga del recupero password (Tentativi 7-12), gli
altri 3 flussi WA (invito, benvenuto, subaffitto_confermato) non erano
ancora stati testati end-to-end perche' i 3 template stagionali sono
ancora pending Meta (in attesa di approval + esito appeal categoria).
Quando Meta approvera', sara' la prima volta che il codice gira con i
nuovi template. Per evitare di scoprire bug latenti analoghi a quelli
della saga, sono state applicate preventivamente le lezioni dei
Tentativi 7-12 a tutti i punti di chiamata ancora non testati.

**Analisi diff per ciascuna lezione**:

| Lezione | Applicabile ai 3 flussi? | Azione |
|---|---|---|
| T7 (URL `?` mancante nel template) | Solo `invito` ha bottone URL. Pattern diverso da recupero_password (qui `?invito={{X}}` come query string completa nel template, non `verify{{4}}` come path puro). Va verificato empiricamente post-approval Meta. | Aggiunto TODO esplicito in sezione 10 (test long-press) |
| T9 (frontend Authorization mancante) | SI per `inviaEmail` + `inviaWhatsapp` (fetch raw con Auth condizionale). NO per `richiediResetCliente` (gia' ha guard `no_session` esplicito). | ✅ Refactor preventivo `js/utils.js` |
| T11 (verify_jwt=false per chiavi non-JWT) | NO. `invia-email` e `richiedi-reset-cliente` chiamate solo da utenti loggati con user-JWT validi -> gateway con verify_jwt=true funziona. `invia-whatsapp` gia' a verify_jwt=false post-T12. | Nessuna azione |
| T12 (security guard interno) | Gia' applicato a `invia-whatsapp` in T12 (richiesto service-role O user-JWT valido). Le altre function non ne hanno bisogno (verify_jwt=true filtra il gateway). | Nessuna azione |

**Refactor `js/utils.js`** (commit `ce34495c` del 5 giu 2026):
- `inviaEmail`: fetch raw → `sb.functions.invoke('invia-email', { body })`,
  + early-return `no_session` esplicito
- `inviaWhatsapp`: fetch raw → `sb.functions.invoke('invia-whatsapp', { body })`,
  + early-return `no_session` esplicito
- `richiediResetCliente`: INVARIATO (gia' aveva guard `no_session`, evito
  diff non necessario)

**Cache buster** (commit Claude Code del 5 giu 2026):
- `js/utils.js` in `index.html`: aggiunto `?v=20260605b` (prima non aveva
  cache buster). Necessario per forzare il refresh nei browser dei manager
  che hanno gia' la versione vecchia di utils.js in cache.

**Test smoke a freddo (dopo Meta approva i 3 template)**:
1. Manager invita un nuovo cliente con WA consenso → atteso WA invito
   arriva sul cell del cliente con bottone funzionante
2. Cliente completa la registrazione via link invito → atteso WA
   benvenuto arriva sul cell del cliente
3. Manager conferma un sub-affitto → atteso WA "Sub-affitto confermato"
   arriva sul cell del cliente con dettagli periodo + crediti

**Vulnerabilita' notata durante l'analisi (non in scope T13, segnalata
per il futuro)**: in `invia-whatsapp`, per i tipi non-recupero
(invito/benvenuto/subaffitto_confermato), il codice NON verifica che
il `callerUserId` (manager loggato) sia effettivamente proprietario
dello `stabilimento_id` indicato nel payload. Un manager autenticato
di stabilimento X potrebbe in teoria chiamare invia-whatsapp con
cliente_id e stabilimento_id di stabilimento Y, manipolando il payload.
Attacco improbabile (richiede conoscere UUID privati di altri
stabilimenti e clienti) ma teoricamente possibile. Hardening futuro:
estendere l'ownership check del tipo recupero_password (T12) anche
agli altri tipi. NON urgente.

**Lezione applicabile in generale**: quando si risolve un bug in un
flusso, fare sempre un sweep dei pattern analoghi nel codice. Se la
root cause era un anti-pattern (es. fetch raw con Auth condizionale),
correggere TUTTI i punti che lo usano, non solo quello che ha mostrato
il bug. Riduce il rischio di scoperta tardiva di bug latenti in flussi
non testati.

### Tentativo 14 (6 giugno 2026): diagnostica dettagli template via check-template-status

- check-template-status esteso con dettagli per template (variables +
  types_detail) per diagnosticare bug sostituzione variabili button URL nei
  template spiaggiamia_*. Nessuna modifica al runtime di invio.

## 8. Fase 3 — Reset password manager-driven

Completata in main il 3 giu 2026. PR #104 + #105 + #106 + commit standalone.
Bugfix URL aggiunto il 5 giu 2026 (vedi Tentativo 7 sezione 7).

Test reset password via **email**: ✅ funziona end-to-end.

Test reset password via **WhatsApp** (manager-driven, `richiedi-reset-cliente`):
✅ funziona end-to-end post-bugfix del 5 giu 2026.

Test recupero password via **WhatsApp** (self-service, `recupero-password`):
✅ FUNZIONANTE end-to-end (verificato 5 giu 2026 sera, post-saga 4 bugfix
Tentativi 7+9+11+12). Stack completo: frontend `sb.functions.invoke()` →
gateway con `verify_jwt=false` → `recupero-password` v11 → `auth.admin.
generateLink` → fetch a `invia-whatsapp` v18 (`verify_jwt=false` + guard
interno) → Twilio API → WA delivery.

## 9. STATO DEGLI STEP

- [x] **0. Strategia / provider Twilio / architettura** — definite
- [x] **1. Migration consenso** — `whatsapp_consenso` + `whatsapp_consenso_at`
- [x] **5a. Consenso in anagrafica gestore**
- [x] **5b. Preferenze dashboard stagionale**
- [x] **2. Setup Twilio** — account paid, secret configurati
- [x] **2b. WhatsApp Sender BYON** — eSIM Iliad `+393520426199` ONLINE
- [x] **3. Template invito/benvenuto/subaffitto** — creati con Content SID
- [x] **4a. Tab WhatsApp gestore**
- [x] **4b. Edge Function `invia-whatsapp`** — v18 ACTIVE (5 giu 2026 post-T12)
- [x] **4b-bis. Agganci agli eventi** — tutti completi
- [x] **Cleanup `whatsapp_config`** — tabella eliminata
- [x] **Fase 3 — Reset password manager-driven**
- [x] **richiedi-reset-cliente Edge Function** — v12
- [x] **recupero-password Edge Function** — v11
- [x] **Profilo WhatsApp Business completo**
- [x] **Logo brand SpiaggiaMia** — v3 + v4
- [x] **Edge Function `manage-wa-business-profile`** — v3 ACTIVE
- [x] **DevBoard sezione "WhatsApp Business Profile"**
- [x] **Update campi testuali profilo business via API**
- [x] **Logo brand caricato via Meta UI** — workaround Tentativo 10
- [x] **Verifica visiva profilo business completo**
- [x] **Recupero password v3 sottomesso e approvato Meta**
- [x] **WA_SID_RECUPERO settato su Supabase Secrets**
- [x] **Edge Function check-template-status**
- [x] **Edge Function recreate-whatsapp-templates**
- [x] **Ricreazione template stagionali**
- [x] **Secret Supabase aggiornati con nuovi SID**
- [x] **Verifica passaggio a pending Meta**
- [x] **Appeal categoria sottomesso per i 3 stagionali**
- [x] **Bugfix URL `?` mancante in richiedi-reset-cliente** — commit `29c649e1` (T7)
- [x] **Bugfix URL `?` mancante in recupero-password** — commit `69c66486` (T7)
- [x] **Bugfix frontend `doForgotPassword`** — commit `def7f67b` (T9)
- [x] **Cache buster `?v=20260605a` in index.html per js/auth.js** — commit `048515a3` (Claude Code)
- [x] **Bugfix `verify_jwt=false` per `recupero-password`** — commit `141d2832` (T11), redeploy v11
- [x] **Bugfix `verify_jwt=false` + security guard per `invia-whatsapp`** — commit `2be6242f` + `cccb6409` (T12), redeploy v18
- [x] **Test end-to-end WA reset password (manager-driven)** sul cellulare — ✅
- [x] **Test end-to-end WA recupero password (self-service)** sul cellulare — ✅
- [x] **Refactor preventivo helper `inviaEmail`/`inviaWhatsapp`** (Tentativo 13) — commit `ce34495c` 5 giu 2026 sera, sb.functions.invoke + no_session guard
- [x] **Cache buster `?v=20260605b` per js/utils.js in index.html** — post-T13 (Claude Code)
- [ ] **Test end-to-end WA invito** sul cellulare — bloccato da approval Meta template stagionale
- [ ] **Test end-to-end WA benvenuto** sul cellulare — bloccato da approval Meta template stagionale
- [ ] **Test end-to-end WA subaffitto_confermato** sul cellulare — bloccato da approval Meta template stagionale
- [ ] **TODO long-press WA invito** post-approval Meta — verifica URL `?` preservato, eventuale fix analogo a T7
- [ ] **Hardening sicurezza**: ownership check anche per tipi non-recupero in invia-whatsapp (NON urgente, segnalato in T13)
- [ ] **Esito appeal categoria 3 stagionali** — atteso 24-72h
- [x] **Edge Function `create-utility-backup-templates`**
- [x] **9 template UTILITY backup creati e submittati**
- [x] **DevBoard mobile-friendly per invocazioni admin**
- [ ] **Esito approval Meta per i 9 backup** — atteso 24-72h
- [ ] **Aggiornamento `invia-whatsapp` per nuove signature A/B/C** — solo se si swappano
- [ ] **Approvazione Meta business-initiated dei 3 template invito/benvenuto/subaffitto**
- [ ] **Business verification Meta** — bloccata da mancanza P.IVA (long term)
- [ ] **Pulizia 4 record duplicati telefono `+393299088725`** — prima di demo reali

### 6 giugno 2026

- Fix `invia-whatsapp` per tipo `invito`: la Content Variable del button
  URL era passata con chiave inventata `"button_1_url_0"` (ignorata da
  Twilio → arrivava il sample value `abc123token` nel link).
  Corretto in `"3"`, coerente col template `spiaggiamia_invito_stagionale`
  che usa `{{3}}` dentro `https://spiaggiamia.com/?invito={{3}}`.
  Bug confermato via devboard ("Check template status" esteso).
  Altri tipi (benvenuto, subaffitto, recupero_password) già corretti,
  non toccati.

## 10. Come riprendere il test (quando Meta approva)

**Per i 3 template invito/benvenuto/subaffitto** (ancora pending):
nessun cambio codice necessario, Edge Functions già pronte e secret aggiornati →
al primo evento (invito/benvenuto/subaffitto) i WA dovrebbero partire
automaticamente. ⚠️ Categoria al momento: MARKETING (con appeal in corso del 4
giu).

**Se l'appeal categoria del 4 giu è "Invariati"**: valutare modifica body
o swap ai 9 backup (sezione 4).

**Verifica delivery reale**: Meta Business Manager → WhatsApp Manager →
Numeri di telefono → Insights → "Tutti i messaggi" → deve aumentare
"Messaggi inviati" e "Messaggi consegnati".

**⚠️ Test button URL**: sempre fare long-press sul bottone WA per copiare
l'URL effettivo, e verificare che corrisponda al pattern atteso. Meta può
normalizzare l'URL durante l'approval rimuovendo caratteri speciali (vedi
bugfix `?` del 5 giu 2026 in sezione 7 - Tentativo 7).
**TODO post-approval Meta del template `spiaggiamia_invito_stagionale`**:
fare long-press sul bottone WA del primo messaggio di invito ricevuto
e verificare che l'URL ricomposto sia `https://spiaggiamia.com/?invito=<token>`
con il `?` preservato. Se Meta lo ha rimosso (come per recupero_password
v3), l'URL sarebbe `https://spiaggiamia.com/invito=<token>` (path
malformato) → applicare un fix analogo a T7 in `invia-whatsapp` per
passare il token con `?invito=` prefisso. Pattern del template diverso
da recupero_password, quindi non e' garantito che subisca la stessa
normalizzazione.

**⚠️ Test fire-and-forget**: quando un flusso ritorna sempre risposta
generica, NON fidarsi dell'UX. Controllare i log della edge function con
`Supabase:get_logs` MCP per HTTP access + Dashboard per console.log/error.

**Verifica visiva profilo business**: tappare il header del numero
`+393520426199` nella chat WhatsApp dal destinatario. Dovrebbero comparire:
logo ombrellone SpiaggiaMia (avatar), nome "SpiaggiaMia", about, description,
email e sito cliccabili, categoria "Travel & Transportation". Se vedi ancora
l'avatar di default ("S" arancione), il logo va caricato via Meta UI
(Tentativo 10), NON via re-update dell'API.

## 11. Per nuove sessioni Claude

Leggi questo file con `get_file_contents` per orientarti. Punti chiave:
- Tutta l'infrastruttura tecnica è in main e in produzione
- Edge functions deployate: `invia-whatsapp` v18 (verify_jwt=false post-T12),
  `richiedi-reset-cliente` v12 (post-bugfix 5 giu), `recupero-password` v11
  (verify_jwt=false post-T11), `check-template-status` v8,
  `recreate-whatsapp-templates`, `create-utility-backup-templates`,
  `manage-wa-business-profile` v3
- **Tutti i flussi password via WhatsApp: ✅ FUNZIONANTI end-to-end**
  (post-saga 4 bugfix del 5 giu: Tentativi 7+9+11+12)
- **Lezioni saga applicate preventivamente agli altri 3 flussi WA**
  (invito/benvenuto/subaffitto_confermato): commit `ce34495c` del 5 giu
  sera ha migrato `inviaEmail` e `inviaWhatsapp` in `js/utils.js` a
  `sb.functions.invoke()` con early-return `no_session`. Vedi
  Tentativo 13 sezione 7.
- **Profilo business WA completo** con logo brand SpiaggiaMia (logo via Meta
  UI, resto via API Twilio Senders del 5 giu)
- Restano open solo:
  - approval Meta dei 3 template stagionali (asincrona, fuori controllo)
  - esito appeal categoria UTILITY dei 3 stagionali (24-72h da 4 giu)
  - approval Meta dei 9 template UTILITY backup
  - pulizia 4 record duplicati `+393299088725` prima di demo

Verifica status template:
- Edge Function `check-template-status` (read-only) — modo più rapido
- https://console.twilio.com/us1/develop/sms/content-template-builder
- https://business.facebook.com/latest/whatsapp_manager/message_templates

Verifica profilo business:
- **Source of truth**: dal cellulare destinatario, tappare header numero
- `manage-wa-business-profile?mode=get` può ritornare profilo vuoto pur
  essendo popolato lato Meta (bug noto cache Twilio v2)
- Per modifiche al logo: SEMPRE via Meta Business Manager UI (Tentativo 10)

Debug 401/403 inattesi:
- `Supabase:get_logs` con service `edge-function` mostra status code e
  execution_time_ms. Un 401 con ~90-200ms = rifiuto al gateway. Un 401
  con ~500-1000ms = entrato nel codice ma auth fallita internamente.
- **Nuove chiavi Supabase (`sb_publishable_*` / `sb_secret_*`)**: queste
  non sono JWT, NON passano `verify_jwt=true` al gateway. Funzionano solo
  come `apikey` header o se `verify_jwt=false`. Vedi Tentativi 11+12.
- Frontend deve sempre chiamare le edge function via `sb.functions.invoke()`
  per garantire l'`Authorization` automatico.
- Per i `console.log/error` dell'Edge Function: il MCP `Supabase:get_logs`
  mostra solo HTTP access. I log testuali vanno cercati nel Dashboard:
  `https://supabase.com/dashboard/project/{ref}/functions/{name}/logs`

Vincoli formato immagini Meta:
- Logo profilo: 640×640 minimo, 1080×1080 raccomandato, **JPEG vero** (no WebP).
- Cover/banner: 1920×1080, max 5 MB, JPEG/PNG.

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
