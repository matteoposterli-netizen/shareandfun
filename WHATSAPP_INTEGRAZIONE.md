# SpiaggiaMia — Integrazione notifiche WhatsApp (piano e stato)

Documento di riferimento per la knowledge base del progetto.
Ultimo aggiornamento discussione: 2 giugno 2026.

## 1. Obiettivo

WhatsApp deve funzionare **esattamente come l'email**: per ogni evento il sistema invia
su **email e/o WhatsApp** a seconda di quali contatti sono presenti/attivi in anagrafica
del cliente (uno, l'altro o entrambi). Tono WhatsApp più informale. Primo rilascio: verso
gli **stagionali** (clienti).

## 2. Flusso/esperienza (confermato)

Tre momenti, ognuno inviato su email e/o WhatsApp secondo i contatti in anagrafica:
1. **Invito** — il gestore invita il cliente; arriva un link per creare la password e
   accedere al proprio account.
2. **Benvenuto** — quando il cliente si registra (crea la password).
3. **Sub-affitto confermato** — quando il gestore conferma un sub-affitto: "dal giorno X
   al giorno Y (o giorno singolo) il tuo ombrellone è stato affittato; credito guadagnato
   X; credito totale Y".

(È un "dispatcher" multi-canale: stessa logica dell'email, con WhatsApp in parallelo.)

## 3. Decisioni strategiche prese

- **NO al "WhatsApp privato" automatizzato** (no API ufficiale per account personali;
  Baileys/whatsapp-web.js violano i ToS, rischio ban, casi di malware). Scartato.
- **Strada: WhatsApp Business Platform ufficiale tramite BSP = Twilio.** Pay-as-you-go,
  nessun canone, API REST semplice. Solo invio (no inbox). ~$0,005/msg + fee Meta.
  Alternativa futura 360dialog (no markup ma ~49 EUR/mese) se i volumi crescono.
- **Un solo numero SpiaggiaMia per tutti i gestori** (attribuzione nel testo). Embedded
  Signup per numeri propri dei gestori rimandato a dopo il pilota.
- **Config WhatsApp = di sistema/globale** (Content SID dei template + numero mittente):
  unica per tutti, perché il numero è unico. Vista (sola lettura) dalla **tab WhatsApp**
  del pannello gestore (vedi §7). NON per-stabilimento, NON editabile da UI.
- **Fallback:** WhatsApp parte solo per chi ha **telefono + consenso**; gli altri solo
  email. Nessun blocco all'onboarding.
- **(2 giu 2026) Numero del pilota = BYON (Bring Your Own Number) con eSIM dedicata.**
  Verificato: gli account Twilio **trial NON possono registrare WhatsApp Sender** → fatto
  **upgrade a paid** (account ora Active, ~$20 fondi). I numeri **italiani su Twilio**
  richiedono un Regulatory Bundle (documenti + fino a 3 gg lavorativi) → aggirato scegliendo
  il **BYON**: una **eSIM operatore italiano dedicata** (Iliad, a nome Matteo, numero
  `+393520426199` confermato), mai usata su WhatsApp, capace di ricevere SMS/voce per l'OTP.
  Il BYON evita il bundle Twilio ma NON il livello Meta (serve comunque creare Meta Business
  Portfolio + WABA via Self Sign-up).

## 4. Costi

Notifiche transazionali = categoria **utility** -> pochi centesimi/msg in Italia; i
messaggi di servizio (risposta entro 24h) gratis. Twilio +~$0,005/msg, nessun canone.
Per il pilota: trascurabile.

## 5. Vincoli Meta (validi anche con Twilio)

- **Template pre-approvati** (utility = poco attrito, approvati in pochi minuti).
- **Opt-in obbligatorio**: consenso esplicito e tracciabile PRIMA di scrivere. Poiché il
  primo messaggio (invito) parte prima che il cliente abbia un account, il consenso si
  raccoglie in **anagrafica cliente lato gestore** (telefono + flag consenso), non solo
  nella dashboard stagionale.
- **Verifica business Meta** per la produzione (2–10 gg). Senza: max 250 conversazioni/24h.
- **Placeholder a inizio/fine messaggio = rifiuto automatico** (verificato Twilio/Meta):
  i body non devono iniziare né finire con `{{n}}`. Per questo il Template 3 chiude con
  "Buona estate!" dopo `{{4}}`.
- Comunicazione libera/promozionale = categoria *marketing* -> fuori dal primo rilascio.

## 6. Stato tecnico (riferimento)

Repo: `matteoposterli-netizen/shareandfun`. `CLAUDE.md` = architettura autorevole.

- **Email esistenti**: Edge Function `supabase/functions/invia-email/index.ts` (Resend),
  switch su `tipo`: benvenuto, attesa, approvazione, invito, credito_accreditato,
  credito_ritirato, chiusura_stagione, comunicazione, ombrellone_disattivato.
- **WhatsApp (NUOVO, Step 4b, 2 giu 2026)**: Edge Function
  `supabase/functions/invia-whatsapp/index.ts` — gemella di `invia-email`, invio via Twilio
  Content API. Switch su `tipo`: `invito`, `benvenuto`, `subaffitto_confermato`. Legge
  Content SID + numero sender dalla tabella `whatsapp_config`; auth da secret env
  (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`). Guard E.164 su `telefono`; si fida del
  chiamante per il consenso. Audit log via RPC `audit_log_write` (`entity_type:"whatsapp"`).
- **Tabella `whatsapp_config` (NUOVO, Step 4b)**: riga unica (singleton). Campi
  `sender_number`, `stato` ('sandbox'/'production'), `content_sid_invito`,
  `content_sid_benvenuto`, `content_sid_subaffitto`, `updated_at`. RLS: sola lettura per
  authenticated, scrittura solo service_role. Seedata con i 3 Content SID; `sender_number`
  da popolare con `+393520426199` dopo lo Step 2b.
- **Punti di invio chiave** (js/clienti.js): l'**invito** parte via
  `inviaEmail('invito', { email, nome, cognome, ombrellone, invite_link }, currentStabilimento, {oggetto,testo})`
  sia nell'import Excel (`confirmImportaExcelExecute`, se attivo `xlsx-invia-inviti`) sia
  nel bulk invite (`confirmBulkInvite`). Link invito: `${origin}/?invito=${token}`.
  -> Qui andrà affiancato l'invio WhatsApp (Step 4b-bis).
  -> DA MAPPARE (Step 4b-bis): i punti dove oggi partono il **benvenuto**
     (registrazione/creazione password) e il **sub-affitto confermato** (conferma del
     gestore + accredito credito) — lì si aggancia l'invio WhatsApp corrispondente.
- **Tabella `clienti_stagionali`**: `telefono` (modificabile dal gestore nel Tab
  "Ombrelloni e clienti"), `email`, `nome`, `cognome`, `credito_saldo`, `user_id`,
  `stabilimento_id`, `ombrellone_id`, `approvato`, `invito_token`, `invitato_at`.
  **+ (Step 1, applicati al DB)**: `whatsapp_consenso boolean DEFAULT false`,
  `whatsapp_consenso_at timestamptz`. Scritti dal form di modifica cliente (Step 5a) e
  dalla scheda "Notifiche" della dashboard stagionale (Step 5b).
- **Dashboard stagionale** (`#view-stagionale`, js/stagionale.js): schede
  `.stag-tab[data-stag-tab]`/`#stag-tab-X`, `stagSwitchTab()`. Ora include la scheda
  "Notifiche" (Step 5b). Helper: `sb`, `currentUser`, `stagClienteId`, `showAlert`,
  `showLoading/hideLoading`, `loadStagionaleData()`.
- **Pannello gestore — Comunicazioni** (js/comunicazioni.js): tre sotto-tab
  `.comm-tab`/`#comm-pane-<tab>` con `comunicazioniSwitchTab()`: **email** (broadcast
  funzionante via Resend), **whatsapp** (oggi placeholder "Stiamo lavorando"), **sms**
  (placeholder). `inviaEmail()` è in js/email.js.

## 7. Dove vive la gestione WhatsApp (tab del gestore)

Tutta la gestione WhatsApp va nella **tab WhatsApp** dentro Comunicazioni (`#comm-pane-whatsapp`,
oggi placeholder). Sarà il pannello unico per:
- i **Content SID** dei 3 template + numero mittente + stato (sandbox/produzione) =
  "variabili di appoggio" (config globale di sistema, **sola lettura** — fonte: tabella
  `whatsapp_config`);
- l'**anteprima** dei 3 messaggi automatici con le loro variabili.
NB: i 3 messaggi sono **automatici/transazionali** (partono dal backend all'evento), NON
broadcast manuali. Il broadcast WhatsApp libero è fuori dal primo rilascio (marketing).

## 8. Template del primo rilascio (3, categoria Utility, verso stagionali)

Creati nel Content Template Builder il **2 giu 2026** (lingua: Italian, categoria: Utility).
Stato: bozza con Content SID assegnato; **submit for approval in attesa del WhatsApp Sender**
(business-initiated ancora pending finché il sender non è registrato). Testi definitivi:

1. **`spiaggiamia_invito_stagionale`** — Content SID `HXa6ec64d24da74f0d8348c7e180d727e8`
   (Call To Action, bottone "Crea password")
   > Ciao {{1}}! 🏖️ {{2}} ti dà il benvenuto su SpiaggiaMia: qui gestisci il tuo ombrellone per la stagione. Crea la password per iniziare.
   - Variabili body: 1=nome, 2=stabilimento
   - Bottone URL dinamico: `https://spiaggiamia.com/?invito={{3}}` (3=token invito)

2. **`spiaggiamia_benvenuto_stagionale`** — Content SID `HXf42d6a56208f5e790550d1e38a9f54a3`
   (Text)
   > Ciao {{1}}! 🌊 Il tuo account SpiaggiaMia è attivo. Segnala quando non ci sei: ogni volta che {{2}} sub-affitta il tuo ombrellone accumuli credito. Buona estate!
   - Variabili: 1=nome, 2=stabilimento

3. **`spiaggiamia_subaffitto_confermato`** — Content SID `HXa9170abc05f727eab8fbd4cfa253779b`
   (Text)
   > Ciao {{1}}! ☂️ Buone notizie: il tuo ombrellone è stato affittato {{2}}. Da {{5}} hai guadagnato {{3}} di credito, per un totale di {{4}}. Buona estate!
   - Variabili: 1=nome, 2=periodo, 3=credito guadagnato, 4=credito totale, 5=stabilimento
   - Nota: `{{5}}` compare nel testo prima di `{{4}}`; i ContentVariables si mappano per
     numero, non per ordine di apparizione.

Estensioni future: ritiro credito, chiusura stagione, comunicazioni (cautela: marketing).

## 9. Come funziona Twilio (verificato, giu 2026)

- **Account**: trial **upgradato a paid** (Active) — necessario perché i trial non possono
  registrare WhatsApp Sender. Sandbox testata con successo (invio template demo ricevuto).
- **Credenziali**: Account SID + Auth Token (secret su Supabase, MAI nel codice).
- **Template**: Content Template Builder -> Content SID (`HX…`). I 3 SID sono in §8.
- **Sender**: BYON via Self Sign-up (Console > Messaging > Senders > WhatsApp Senders),
  numero non-Twilio (eSIM Iliad `+393520426199`) verificato con OTP. Crea Meta Business
  Portfolio + WABA.
- **Invio**: REST con `ContentSid` + `ContentVariables` (JSON `{"1":"…","2":"…"}`),
  `From`/`To` con prefisso `whatsapp:`. Endpoint
  `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` (Basic Auth).
- Numero in formato internazionale E.164 senza spazi (`+39…`).

## 10. Numero del pilota e produzione

- **Pilota: BYON con eSIM dedicata** (Iliad, a nome Matteo, `+393520426199`). Numero da
  registrare come **WhatsApp Sender** via Self Sign-up (headless via API, NON l'app
  WhatsApp Business).
- Requisiti numero: **mai registrato su WhatsApp** (non installarci l'app classica),
  riceve **SMS/voce** per OTP (no VOIP/IVR).
- Registrazione: Self Sign-Up nella Console (login Facebook + Meta Business Portfolio +
  WABA). Display name "SpiaggiaMia" rivisto da Meta (se rifiutato: 250 msg/giorno).
  Verifica business Meta completa = solo per alzare i limiti / produzione.
- Stagionalità: numero senza traffico per ~30 gg viene bloccato (err. 63051) -> tenere
  un minimo di traffico periodico fuori stagione.

## 11. Piano operativo — STEP

- [x] **0. Strategia / provider (Twilio) / architettura** — definiti.
- [x] **1. Migration consenso** — FATTO, in `main` + applicata al DB.
- [x] **5a. Consenso in anagrafica gestore** — FATTO, in `main` (PR #97). Checkbox
      consenso + telefono E.164 nel Tab "Ombrelloni e clienti".
- [x] **5b. Preferenze nella dashboard stagionale** — FATTO, in `main`. Scheda "Notifiche"
      con numero + opt-in/revoca lato cliente.
- [x] **2. Setup Twilio** — FATTO (2 giu 2026). Account creato, **upgrade a paid** (Active),
      Sandbox testata. Account SID/Auth Token disponibili (da salvare come secret Supabase).
- [x] **3. Creare i 3 template** — FATTO (2 giu 2026). Creati in bozza nel Content Template
      Builder, **Content SID annotati** (vedi §8). Submit for approval in attesa del Sender.
- [x] **4b. Edge Function `invia-whatsapp` + tabella `whatsapp_config`** — FATTO (2 giu 2026).
      Function e migration committate in `main`, migration applicata al DB. La function è
      "spenta" (risponde 503) finché `sender_number` è vuoto. Aggancio ai punti di invio =
      Step 4b-bis (separato). Vedi §6.
- [ ] **2b. Registrare il WhatsApp Sender (BYON)** — eSIM Iliad ATTIVA (`+393520426199`
      confermato). DA FARE: Self Sign-up (Meta Business Portfolio + WABA + verifica OTP +
      display name "SpiaggiaMia"). Sblocca il submit for approval dei 3 template.
      **È il prossimo passo bloccante alla ripresa.**
- [ ] **4a. Tab WhatsApp (gestore)** — trasformare il placeholder `#comm-pane-whatsapp`
      nel pannello config (sola lettura): Content SID dei 3 template, numero mittente,
      stato, anteprima. Fonte: tabella `whatsapp_config`.
- [ ] **4b-bis. Aggancio ai punti di invio** — chiamare `invia-whatsapp` accanto agli invii
      email esistenti (invito in js/clienti.js + i punti di benvenuto e sub-affitto da
      mappare), solo se `telefono` + `whatsapp_consenso`. Da fare DOPO deploy+test della
      function.
- [ ] **6. Produzione (post-pilota)** — numero dedicato + verifica business Meta completa.

## 12. Deliverable prodotti

- `01_migration_whatsapp_consenso.txt` — migration consenso. **Eseguito** (Step 1).
- `02_ui_consenso_whatsapp_stagionale.txt` — scheda "Notifiche" dashboard stagionale.
  **Eseguito** (Step 5b, in main).
- `03_consenso_whatsapp_anagrafica_gestore.txt` — consenso nel form modifica cliente.
  **Eseguito** (Step 5a, in main, PR #97).
- `04_template_whatsapp_pronti_twilio.txt` — testi dei 3 template (storico). I testi
  **definitivi e i Content SID** sono ora in §8 (fonte di verità).
- `prompt_code_step4b_invia_whatsapp.txt` — prompt tab Code per migration `whatsapp_config`
  + Edge Function `invia-whatsapp`. **Eseguito** (Step 4b, in main).

## 13. Riprendere da qui

Stato (2 giu 2026): Step 0, 1, 5a, 5b, **2, 3, 4b** completati. Lato Twilio: account paid,
Sandbox testata, 3 template in bozza con Content SID (§8). Lato codice: Edge Function
`invia-whatsapp` + tabella `whatsapp_config` in `main` e migration applicata (function
"spenta" finché `sender_number` vuoto). eSIM Iliad `+393520426199` attiva.

**Prossimo passo bloccante: Step 2b — registrare il WhatsApp Sender (BYON)** via Self
Sign-up (Meta Business Portfolio + WABA + OTP + display name). Poi, in ordine:
1. Submit for approval dei 3 template (si sblocca) → attendere "Approved".
2. Impostare secret Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`) + popolare
   `whatsapp_config.sender_number=+393520426199` e `stato='production'`.
3. Deploy `invia-whatsapp` (se non già deployata) + test end-to-end di un invio reale.
4. Step 4b-bis (aggancio ai punti invito/benvenuto/sub-affitto).
5. Step 4a (tab WhatsApp di sola visualizzazione). Step 6 = produzione dopo il pilota.
