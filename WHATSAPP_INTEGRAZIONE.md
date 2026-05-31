# SpiaggiaMia — Integrazione notifiche WhatsApp (piano e stato)

Documento di riferimento per la knowledge base del progetto.
Ultimo aggiornamento discussione: 31 maggio 2026.

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
  unica per tutti, perché il numero è unico. Gestita dalla **tab WhatsApp** del pannello
  gestore (vedi §7). NON per-stabilimento.
- **Fallback:** WhatsApp parte solo per chi ha **telefono + consenso**; gli altri solo
  email. Nessun blocco all'onboarding.

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
- Comunicazione libera/promozionale = categoria *marketing* -> fuori dal primo rilascio.

## 6. Stato tecnico (riferimento)

Repo: `matteoposterli-netizen/shareandfun`. `CLAUDE.md` = architettura autorevole.

- **Email esistenti**: Edge Function `supabase/functions/invia-email/index.ts` (Resend),
  switch su `tipo`: benvenuto, attesa, approvazione, invito, credito_accreditato,
  credito_ritirato, chiusura_stagione, comunicazione, ombrellone_disattivato.
- **Punti di invio chiave** (js/clienti.js): l'**invito** parte via
  `inviaEmail('invito', { email, nome, cognome, ombrellone, invite_link }, currentStabilimento, {oggetto,testo})`
  sia nell'import Excel (`confirmImportaExcelExecute`, se attivo `xlsx-invia-inviti`) sia
  nel bulk invite (`confirmBulkInvite`). Link invito: `${origin}/?invito=${token}`.
  -> Qui andrà affiancato l'invio WhatsApp.
- **Tabella `clienti_stagionali`**: `telefono` (già gestito via import Excel),
  `email`, `nome`, `cognome`, `credito_saldo`, `user_id`, `stabilimento_id`,
  `ombrellone_id`, `approvato`, `invito_token`, `invitato_at`. **+ NUOVI (Step 1, già
  applicati al DB)**: `whatsapp_consenso boolean DEFAULT false`, `whatsapp_consenso_at
  timestamptz`.
- **Dashboard stagionale** (`#view-stagionale`, js/stagionale.js): schede
  `.stag-tab[data-stag-tab]`/`#stag-tab-X`, `stagSwitchTab()`. Helper: `sb`, `currentUser`,
  `stagClienteId`, `showAlert`, `showLoading/hideLoading`, `loadStagionaleData()`.
- **Pannello gestore — Comunicazioni** (js/comunicazioni.js): tre sotto-tab
  `.comm-tab`/`#comm-pane-<tab>` con `comunicazioniSwitchTab()`: **email** (broadcast
  funzionante via Resend), **whatsapp** (oggi placeholder "Stiamo lavorando"), **sms**
  (placeholder). `inviaEmail()` è in js/email.js.

## 7. Dove vive la gestione WhatsApp (tab del gestore)

Tutta la gestione WhatsApp va nella **tab WhatsApp** dentro Comunicazioni (`#comm-pane-whatsapp`,
oggi placeholder). Sarà il pannello unico per:
- i **Content SID** dei 3 template + numero mittente + stato (sandbox/produzione) =
  "variabili di appoggio" (config globale di sistema);
- l'**anteprima** dei 3 messaggi automatici con le loro variabili.
NB: i 3 messaggi sono **automatici/transazionali** (partono dal backend all'evento), NON
broadcast manuali. Il broadcast WhatsApp libero è fuori dal primo rilascio (marketing).

## 8. Template del primo rilascio (3, categoria Utility, verso stagionali)

Tono breve/informale, max 1–2 emoji. Variabili `{{1}}`… Su Twilio si creano nel Content
Template Builder -> ognuno ha un **Content SID** (`HX…`).

1. **`invito_stagionale`** (con bottone URL "Crea password")
   > Ciao {{1}}! 🏖️ {{2}} ti ha aperto il tuo spazio su SpiaggiaMia per gestire il tuo ombrellone. Crea la tua password per accedere.

   (1=nome, 2=stabilimento; link nel bottone URL)

2. **`benvenuto_stagionale`**
   > Ciao {{1}}! 🌊 Il tuo account SpiaggiaMia è attivo. Da qui segnali le tue assenze e accumuli coin quando {{2}} sub-affitta il tuo ombrellone. Buona estate!

   (1=nome, 2=stabilimento)

3. **`subaffitto_confermato`**
   > Ciao {{1}}! ☂️ Il tuo ombrellone è stato affittato {{2}}. Hai guadagnato {{3}} — credito totale: {{4}}. Lo usi al bar e ristorante di {{5}}!

   (1=nome, 2=periodo già formattato es. "dal 5 al 7 luglio"/"il 5 luglio", 3=credito
   guadagnato, 4=credito totale, 5=stabilimento)

Estensioni future: ritiro coin, chiusura stagione, comunicazioni (cautela: marketing).

## 9. Come funziona Twilio (verificato, mag 2026)

- **Test -> Sandbox**: numero condiviso, nessun numero proprio; dal telefono mandi
  "join <codice>". Nel sandbox solo template pre-approvati.
- **Credenziali**: Account SID + Auth Token (secret su Supabase, MAI nel codice).
- **Template**: Content Template Builder -> Content SID (`HX…`).
- **Invio**: REST con `ContentSid` + `ContentVariables` (JSON `{"1":"…","2":"…"}`),
  `From`/`To` con prefisso `whatsapp:`. Endpoint
  `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` (Basic Auth).
- Numero in formato internazionale (+39…).

## 10. Numero di produzione (non serve per il pilota)

- Pilota: Sandbox. Produzione: numero dedicato registrato come **WhatsApp Sender**
  (headless via API, NON l'app WhatsApp Business). Raccomandato: numero Twilio dedicato.
- Requisiti: NON già registrato su WhatsApp; deve ricevere SMS/voce per OTP (no VOIP).
- Registrazione: Self Sign-Up nella Console (login Facebook + Meta Business) + verifica
  business Meta. Display name "SpiaggiaMia" rivisto da Meta (se rifiutato: 250 msg/giorno).
- Stagionalità: numero senza traffico per ~30 gg viene bloccato (err. 63051) -> tenere
  un minimo di traffico periodico fuori stagione.

## 11. Piano operativo — STEP

- [x] **0. Strategia / provider (Twilio) / architettura** — definiti.
- [x] **1. Migration consenso** — FATTO. `20260531000000_whatsapp_consenso.sql` su `main`
      e applicata al DB (`whatsapp_consenso`, `whatsapp_consenso_at` su `clienti_stagionali`).
- [ ] **5a. Consenso in anagrafica gestore** — aggiungere telefono + flag consenso
      WhatsApp dove il gestore gestisce i clienti (form manuale + eventuale colonna
      nell'import Excel). È il punto da cui si abilita l'invio (invito). Indip. da Twilio.
- [ ] **5b. Preferenze nella dashboard stagionale** — PROMPT PRONTO
      (`02_ui_consenso_whatsapp_stagionale.txt`): scheda "Notifiche" per gestire/revocare
      numero + consenso lato cliente. Da incollare in Claude Code. Indip. da Twilio.
- [ ] **2. Setup Twilio** — account + Sandbox + Account SID/Auth Token. (Sessione Twilio.)
- [ ] **3. Creare i 3 template** (invito/benvenuto/subaffitto) nel Content Template
      Builder -> 3 **Content SID**. (Sessione Twilio.)
- [ ] **4a. Tab WhatsApp (gestore)** — trasformare il placeholder `#comm-pane-whatsapp`
      nel pannello config: Content SID dei 3 template, numero mittente, stato, anteprima.
      Salva su una config globale di sistema. (Accoppiato ai Content SID -> con Step 3.)
- [ ] **4b. Edge Function `invia-whatsapp`** — gemella di `invia-email`; mappa `tipo` ->
      template (Content SID dalla config §7), invia via Twilio, solo se telefono+consenso.
      Agganciata accanto agli invii email esistenti (invito in clienti.js, benvenuto alla
      registrazione, sub-affitto alla conferma del gestore). Secret Twilio su Supabase.
- [ ] **6. Produzione (post-pilota)** — numero Twilio dedicato + verifica business Meta.

## 12. Deliverable prodotti

- `01_migration_whatsapp_consenso.txt` — migration consenso. **Eseguito** (Step 1).
- `02_ui_consenso_whatsapp_stagionale.txt` — scheda "Notifiche" dashboard stagionale
  (Step 5b). **Da eseguire.**

## 13. Riprendere da qui

Stato: **Step 0 e 1 completati**. Indipendenti da Twilio e pronti/da fare: Step 5a
(consenso in anagrafica gestore — da preparare) e Step 5b (prompt 02 pronto).
Sessione Twilio (prossima): Step 2 (account+Sandbox) e Step 3 (3 template -> 3 Content
SID); con i Content SID si fanno Step 4a (tab WhatsApp config) + 4b (Edge Function), che
sono accoppiati. Step 6 = produzione dopo il pilota.
