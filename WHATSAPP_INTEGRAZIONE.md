# SpiaggiaMia — Integrazione notifiche WhatsApp (stato e piano)

Documento di riferimento per la knowledge base del progetto.
Ultimo aggiornamento: 2 giugno 2026 (dopo test reale end-to-end).

## STATO ATTUALE (TL;DR)

**Integrazione completa e funzionante end-to-end. Bloccata solo dall'approvazione
Meta del template business-initiated.**

- ✅ Frontend → Edge Function → Twilio: catena verificata in produzione (POST 200,
  execution ~1.8s, conferma chiamata reale a Twilio)
- ✅ Twilio Sender `+393520426199` ONLINE, display name "SpiaggiaMia"
- ✅ Tutti i 3 template approvati per **WhatsApp user initiated**
- ⏳ Tutti i 3 template ancora **PENDING** per **WhatsApp business initiated**
  (necessario per inviare proattivamente a chi non ha mai scritto al numero)
- ❌ Errore Twilio attuale: **63016 "Outside messaging window"** — sintomo classico
  di template business-initiated non ancora abilitato

**Tempo di attesa Meta**: 6-48h tipiche per WABA appena creati. Quando il box
"WhatsApp business initiated" diventerà verde su tutti e 3 i template, il WhatsApp
partirà automaticamente al primo evento.

## 1. Obiettivo

WhatsApp funziona **in parallelo all'email**: per ogni evento il sistema invia su
email e/o WhatsApp a seconda di telefono + consenso del cliente. Tono WhatsApp
informale. Primo rilascio: notifiche transazionali verso clienti **stagionali**.

## 2. Flusso/eventi (3 messaggi automatici)

1. **Invito** — gestore invita il cliente; link per creare la password.
2. **Benvenuto** — quando il cliente completa la registrazione (`auth.js`).
3. **Sub-affitto confermato** — quando il gestore conferma un sub-affitto: periodo
   + credito guadagnato + credito totale.

WhatsApp è un dispatcher fire-and-forget accanto a `inviaEmail`. L'errore WA non
blocca mai email o flusso DB.

## 3. Architettura (gestione centralizzata admin)

Messaggi uguali per tutti i gestori, non personalizzabili dalla UI. Tab WhatsApp
del gestore in sola lettura.

- **Edge Function `invia-whatsapp`** (`supabase/functions/invia-whatsapp/index.ts`):
  - Credenziali e Content SID **da env var** (Supabase secrets), niente tabella DB
  - Riceve `{ tipo, stabilimento_id, cliente_id, ...params }`, fa lookup autonomo
    di cliente e stabilimento
  - Skip silenzioso se `wa_enabled=false`, `whatsapp_consenso=false`, o telefono
    non E.164 valido
- **Helper frontend** `inviaWhatsapp(tipo, params, stab)` in `js/utils.js`:
  fire-and-forget; si ferma se `stab?.wa_enabled` falso (evita chiamate inutili)
- **Toggle per-stabilimento**: `stabilimenti.wa_enabled` (boolean, default false)
- **Consenso per-cliente**: `clienti_stagionali.whatsapp_consenso` +
  `whatsapp_consenso_at`
- **Secret Supabase**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WA_FROM=whatsapp:+393520426199`, `WA_SID_INVITO`, `WA_SID_BENVENUTO`,
  `WA_SID_SUBAFFITTO`

## 4. Template Twilio (Content SID definitivi)

Categoria **Utility**, lingua **Italian**.

1. **`spiaggiamia_invito_stagionale`** — SID `HXa6ec64d24da74f0d8348c7e180d727e8`
   (Call To Action con bottone URL)
   - Variabili body: 1=nome, 2=stabilimento
   - Bottone URL dinamico: token invito (chiave `button_1_url_0`)

2. **`spiaggiamia_benvenuto_stagionale`** — SID `HXf42d6a56208f5e790550d1e38a9f54a3`
   (Text)
   - Variabili: 1=nome, 2=stabilimento

3. **`spiaggiamia_subaffitto_confermato`** — SID `HXa9170abc05f727eab8fbd4cfa253779b`
   (Text)
   - Variabili: 1=nome, 2=periodo, 3=credito guadagnato, 4=credito totale,
     5=stabilimento

## 5. Numero pilota: BYON eSIM Iliad

- Numero **`+393520426199`**, dedicato a SpiaggiaMia, mai usato su WhatsApp prima
- Account Twilio paid (Active)
- Sender ONLINE con display name "SpiaggiaMia"
- Twilio WABA ID: 1658468622079031
- Meta Business Manager ID: 982498484190082

## 6. Vincoli Meta

- **250 conversazioni business-initiated / 24h** finché la business verification Meta
  non è completata (post-pilota)
- **Quality rating "Unavailable"** finora — normale per sender appena registrato

## 7. Test reale eseguito (2 giu 2026, ~21:30-21:47 CEST)

Setup test:
- Stabilimento **Universo** (UUID `2c82f99e-992e-4935-9aa7-9d0bd94d9799`):
  `wa_enabled=true`
- Cliente **Riccardo Marino** (UUID `9fa41ea5-d050-4a03-a9f0-7b4a464255ee`),
  ombrellone 48: telefono `+393299088725`, `whatsapp_consenso=true`

Risultato: 3 invii di invito tentati. Risposta Twilio per tutti:
**Error 63016 — Outside messaging window. For WhatsApp, use a Message Template
instead**.

Diagnosi: la chiamata API sta passando correttamente `ContentSid`, ma Twilio rifiuta
perché il template non è ancora abilitato per business-initiated. La catena tecnica
funziona; manca solo l'OK Meta.

Verifiche fatte nel debug:
- Edge Function logs: 2 invocazioni POST 200, exec ~798ms e ~1815ms (compatibili
  con chiamata reale a Twilio)
- Network DevTools: chiamata `/functions/v1/invia-whatsapp` con status 200
- Twilio Console → Monitor → Messaging Logs: tutti i 3 tentativi "Undelivered"
  con errore 63016
- Twilio Console → Senders: SpiaggiaMia ONLINE
- Twilio Console → Templates: tutti e 3 con "WhatsApp user initiated" verde,
  "WhatsApp business initiated" ancora grigio (pending)

## 8. Bug trovato e fissato durante il debug

`currentStabilimento` viene caricato al login del gestore (in `router.js`,
`select('*')`). Se il gestore modifica `wa_enabled` dal DB SQL (non dalla UI),
la variabile in memoria browser resta stale fino al refresh. **Workaround**:
hard refresh dopo cambio `wa_enabled`. **Fix futuro**: aggiornare
`currentStabilimento` localmente quando il toggle dal pannello Comunicazioni viene
salvato.

## 9. STATO DEGLI STEP

- [x] **0. Strategia / provider Twilio / architettura** — definite
- [x] **1. Migration consenso** — `whatsapp_consenso` + `whatsapp_consenso_at` su
      `clienti_stagionali`
- [x] **5a. Consenso in anagrafica gestore** — checkbox nel form modifica cliente
- [x] **5b. Preferenze dashboard stagionale** — scheda "Notifiche"
- [x] **2. Setup Twilio** — account paid, Sandbox testata, secret configurati
- [x] **2b. WhatsApp Sender BYON** — eSIM Iliad `+393520426199` ONLINE
- [x] **3. Template** — 3 template creati con Content SID
- [x] **4a. Tab WhatsApp gestore** — sub-tab Configurazioni + tab Comunicazioni
      (sola lettura)
- [x] **4b. Edge Function `invia-whatsapp`** — v5 ACTIVE in produzione
- [x] **4b-bis. Agganci agli eventi** — tutti completi:
  - Invito da modal "Aggiungi cliente" (`manager.js → saveCliente`)
  - Invito via import Excel (`clienti.js → confirmImportaExcelExecute`)
  - Invito via bulk invite (`clienti.js → confirmBulkInvite`)
  - Invito singolo da icona ✉️ (passa per `invitaSingolo` → bulk modal → agganciato)
  - Benvenuto (`auth.js → completeInviteRegistration`)
  - Sub-affitto confermato (`manager.js → finalizeBookingSelection`, con fix
    bug latente raccolta date)
- [x] **Cleanup `whatsapp_config`** — migration drop applicata, tabella eliminata
- [x] **Test end-to-end frontend → function → Twilio** — eseguito 2 giu 2026,
      catena funzionante
- [ ] **Approvazione Meta business-initiated dei 3 template** — in corso, attesa
      tipica 6-48h, bloccante per il delivery effettivo
- [ ] **6. Produzione post-pilota** — business verification Meta per superare 250
      conv/24h

## 10. UUID stabilimenti (riferimento)

| Nome | UUID | wa_enabled |
|------|------|------------|
| dede | `5f0cf433-eaf7-4b8b-9da6-a87d972abdda` | false |
| Universo (test in corso) | `2c82f99e-992e-4935-9aa7-9d0bd94d9799` | true |

## 11. Come riprendere il test (quando Meta approva)

**Quando il template business-initiated diventa verde su tutti e 3:**

1. Verifica template approvati: Twilio Console → Content Template Builder → tutti
   con entrambi i pallini verdi (user-initiated + business-initiated)

2. Riprova un evento qualunque (sub-affitto è il più rapido):
   - Login come gestore di Universo
   - Vai su "Gestisci Prenotazioni"
   - Seleziona ombrellone 48 + un giorno
   - Finalizza prenotazione

3. Riccardo Marino (telefono +393299088725) dovrebbe ricevere il messaggio WhatsApp
   nel giro di pochi secondi.

4. Se ancora errore: aprire ticket Twilio Support.

## 12. Riprendere da qui (per nuove sessioni Claude)

Quando riapri una chat, leggi questo file con `get_file_contents`. La configurazione
WhatsApp è **completa**. L'unica cosa che manca è l'approvazione Meta dei template,
che è fuori dal nostro controllo. Tutto il codice e l'infrastruttura è già in main
e in produzione.

Per verificare se Meta ha approvato:
- Pagina template Twilio: https://console.twilio.com/us1/develop/sms/content-template-builder
- Cerca i 3 template `spiaggiamia_*` e guarda se "WhatsApp business initiated" è verde

Se sì → si testa. Se ancora no → si aspetta.
