# SpiaggiaMia — Integrazione notifiche WhatsApp (piano e stato)

Documento di riferimento per la knowledge base del progetto.
Ultimo aggiornamento discussione: 31 maggio 2026.

## 1. Obiettivo

Aggiungere notifiche **WhatsApp** che **affiancano** le email già esistenti, con un
tono più informale adatto al canale. Invio **automatico**. Primo rilascio: notifiche
**solo verso gli stagionali** (clienti).

## 2. Decisioni strategiche prese

- **NO al "WhatsApp privato" automatizzato.** Non esiste API ufficiale per account
  personali; automatizzarli (Baileys / whatsapp-web.js) viola i ToS di Meta, rischia il
  ban permanente del numero e l'ecosistema npm "anti-ban" ha avuto casi di malware.
  Scartato.
- **Strada scelta: WhatsApp Business Platform ufficiale tramite un BSP.**
- **BSP scelto: Twilio.** Pay-as-you-go, nessun canone mensile, API REST semplice,
  affidabile. Solo invio (no inbox, non serve). ~$0,005/msg + fee Meta.
- **Alternativa futura: 360dialog** (nessun markup per messaggio ma ~49 EUR/mese) — da
  valutare solo se i volumi crescono. Attenzione: cambiare BSP dopo è oneroso
  (rinumerare + ri-approvare i template).
- **Architettura mittente: un solo numero SpiaggiaMia per tutti i gestori**, con
  attribuzione nel testo (es. "Da parte di *Bagno Sirena*: …"). Un numero per gestore
  (Embedded Signup) è rimandato a dopo il pilota.
- **Fallback:** WhatsApp parte solo per chi ha **telefono + consenso**; tutti gli altri
  continuano a ricevere **solo email**. Nessun blocco all'onboarding.

## 3. Costi (sintesi)

- Le notifiche del progetto sono **transazionali = categoria "utility"** -> in Italia
  costano pochissimi centesimi a messaggio; i messaggi di servizio (risposte entro la
  finestra di 24h) sono gratis.
- Twilio aggiunge ~$0,005/msg, senza canone mensile.
- **Per il pilota il costo è trascurabile.**

## 4. Vincoli Meta da ricordare (validi anche con Twilio)

- **Template pre-approvati**: i messaggi proattivi richiedono template approvati. Gli
  *utility* hanno poco attrito e in genere vengono approvati in pochi minuti.
- **Opt-in obbligatorio**: serve consenso esplicito e tracciabile dell'utente prima di
  scrivergli. (Per questo aggiungiamo un campo consenso nel DB.)
- **Verifica business Meta**: necessaria per la produzione (2–10 giorni lavorativi).
  Senza verifica si è limitati a 250 conversazioni / 24h (sufficienti per il pilota).
- Una **comunicazione libera/promozionale** del gestore verrebbe classificata come
  *marketing* (più costosa, regole più severe) -> tenuta fuori dal primo rilascio.

## 5. Stato tecnico attuale (riferimento)

Repo: `matteoposterli-netizen/shareandfun`. `CLAUDE.md` = architettura autorevole.

- **Notifiche email esistenti**: Edge Function `supabase/functions/invia-email/index.ts`,
  provider **Resend**. Switch su parametro `tipo` con questi valori:
  `benvenuto`, `attesa`, `approvazione`, `invito`, `credito_accreditato`,
  `credito_ritirato`, `chiusura_stagione`, `comunicazione`, `ombrellone_disattivato`.
  Il `from` usa già il nome dello stabilimento come display name (pattern di attribuzione
  da replicare su WhatsApp).
- **Tabella `clienti_stagionali`**: ha `telefono text` (facoltativo), `email text NOT
  NULL`, `nome`, `cognome`, `credito_saldo`, `user_id`, `stabilimento_id`,
  `ombrellone_id`, `approvato`, `invito_token`, ecc. **+ NUOVI**: `whatsapp_consenso
  boolean DEFAULT false`, `whatsapp_consenso_at timestamptz` (Step 1, già applicati).
- **Dashboard stagionale**: view `#view-stagionale` in index.html con schede
  `.stag-tab[data-stag-tab]` / `#stag-tab-X`, cambio scheda via `stagSwitchTab(tab, btn)`
  (js/stagionale.js). Helper globali: `sb`, `currentUser`, `stagClienteId`,
  `showAlert(idEl,msg,tipo)`, `showLoading()`, `hideLoading()`, `loadStagionaleData()`.
- **RLS**: le policy esistenti su `clienti_stagionali` coprono già l'update da parte del
  cliente stesso e del proprietario -> nessuna nuova policy necessaria per il consenso.
- **Piano**: creare una Edge Function gemella **`invia-whatsapp`** con lo stesso pattern
  di `invia-email`, agganciata accanto agli invii email esistenti.

## 6. Template del primo rilascio (3, categoria Utility, verso stagionali)

Tono WhatsApp: breve, caldo, max 1–2 emoji. Variabili `{{1}}`, `{{2}}`…
Con Twilio si creano nel **Content Template Builder** -> ognuno riceve un **Content SID**
(`HX…`) da usare nell'invio.

1. **`coin_accreditati`**
   > Ciao {{1}}! 🪙 {{2}} ti ha appena accreditato {{3}} su SpiaggiaMia. Nuovo saldo: {{4}}. Li puoi usare al bar e al ristorante dello stabilimento. Buona estate!

   (1=nome, 2=stabilimento, 3=importo, 4=saldo)

2. **`iscrizione_approvata`**
   > Ciao {{1}}! ✅ {{2}} ha approvato la tua iscrizione a SpiaggiaMia. Ora puoi accedere e gestire il tuo ombrellone. A presto in spiaggia!

   (1=nome, 2=stabilimento)

3. **`benvenuto_stagionale`** (con bottone URL "Accedi"; il link va nel bottone, non nel testo)
   > Ciao {{1}}! 🌊 Benvenuto su SpiaggiaMia con {{2}}. Da qui puoi segnalare le tue assenze e accumulare coin quando il tuo ombrellone viene sub-affittato.

   (1=nome, 2=stabilimento)

Estensioni future: `credito_ritirato`, `chiusura_stagione`, eventuali comunicazioni
(con cautela: se promozionali = marketing).

## 7. Come funziona Twilio in pratica (verificato, mag 2026)

- **Test immediato -> Sandbox Twilio**: numero condiviso, nessun numero proprio. Dal tuo
  telefono mandi "join <codice>" al numero sandbox per abilitarti. Nel sandbox si usano
  solo template pre-approvati.
- **Credenziali**: Account SID + Auth Token dalla Console (da mettere come **secret su
  Supabase**, MAI nel codice).
- **Template**: Content Template Builder -> Content SID (`HX…`).
- **Invio**: chiamata REST con `ContentSid` + `ContentVariables` (JSON tipo
  `{"1":"Mario","2":"Bagno Sirena"}`), `From`/`To` con prefisso `whatsapp:`.
  Endpoint: `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`
  (Basic Auth con SID:AuthToken).
- **Numero salvato in formato internazionale** (+39…).

## 8. Numero di produzione (NON serve per il pilota)

- **Pilota/test**: nessun numero, si usa il Sandbox.
- **Produzione**: numero dedicato registrato come **WhatsApp Sender** (numero "headless"
  via API, NON l'app WhatsApp Business sul telefono).
- **Raccomandazione**: acquistare un **numero Twilio dedicato** a SpiaggiaMia.
- **Requisiti del numero**:
  - NON deve avere già un account WhatsApp attivo (se ce l'ha, va eliminato prima).
  - Deve poter ricevere SMS o chiamate per l'OTP di verifica (i VOIP tipo Google
    Voice / Skype di solito non funzionano).
- **Registrazione**: Self Sign-Up nella Console Twilio (login con Facebook + collegamento
  al Meta Business). Serve la **verifica business Meta** per andare live.
- **Display name** "SpiaggiaMia" rivisto da Meta: se rifiutato, limite 250 msg/giorno.
- **Accortezza stagionale**: se un numero non invia traffico per ~30 giorni Meta lo
  blocca (errore 63051). Fuori stagione va tenuto "vivo" con un minimo di traffico
  periodico.

## 9. Piano operativo — STEP

- [x] **0. Strategia, provider (Twilio) e architettura** — definiti (questo documento).
- [x] **1. Migration consenso** — FATTO. File
      `supabase/migrations/20260531000000_whatsapp_consenso.sql` creato e pushato su
      `main`; migration **applicata al DB Supabase** (colonne `whatsapp_consenso` e
      `whatsapp_consenso_at` live su `clienti_stagionali`).
- [ ] **5. UI consenso + telefono** — PROMPT PRONTO
      (`02_ui_consenso_whatsapp_stagionale.txt`): aggiunge una scheda "Notifiche" nella
      dashboard stagionale (`#view-stagionale`) con campo telefono + checkbox consenso;
      salva su `clienti_stagionali` (telefono normalizzato in +39…, `whatsapp_consenso`,
      `whatsapp_consenso_at`). **Da incollare in Claude Code** (non ancora pushato).
      Indipendente da Twilio. (Lo Step 5 è anticipato perché non dipende da Twilio.)
- [ ] **2. Setup Twilio** — creare account -> annotare Account SID + Auth Token ->
      attivare il Sandbox -> abilitare il proprio telefono. (DA FARE — sessione Twilio.)
- [ ] **3. Creare i 3 template** nel Content Template Builder -> annotare i 3 **Content
      SID** (`HX…`). (DA FARE — sessione Twilio.)
- [ ] **4. Edge Function `invia-whatsapp`** — Claude prepara il prompt Claude Code quando
      sono disponibili i 3 Content SID: funzione gemella di `invia-email`, mappa ogni
      `tipo` al rispettivo template, invia via Twilio, parte solo per chi ha telefono +
      consenso; aggancio accanto agli invii email esistenti. Secret Twilio su Supabase.
- [ ] **6. Produzione (post-pilota)** — numero Twilio dedicato + verifica business Meta +
      display name approvato.

## 10. Deliverable già prodotti

- `01_migration_whatsapp_consenso.txt` — prompt Claude Code per la migration consenso.
  **Eseguito** (Step 1 completato).
- `02_ui_consenso_whatsapp_stagionale.txt` — prompt Claude Code per la scheda "Notifiche"
  (telefono + consenso) nella dashboard stagionale. **Da eseguire** (Step 5).

## 11. Riprendere da qui

Stato attuale: **Step 0 e Step 1 completati**. Step 5 ha il prompt pronto
(`02_...txt`) da incollare in Claude Code (frontend, indipendente da Twilio).

Prossima sessione (Twilio): eseguire **Step 2** (account + Sandbox + credenziali) e
**Step 3** (creare i 3 template -> 3 Content SID). Con i 3 Content SID si sblocca lo
**Step 4** (Claude prepara il prompt della Edge Function `invia-whatsapp`). Lo **Step 6**
è il passaggio in produzione, dopo la validazione del pilota.
