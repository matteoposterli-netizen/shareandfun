# SpiaggiaMia — Integrazione notifiche WhatsApp (stato e piano)

Documento di riferimento per la knowledge base del progetto.
Ultimo aggiornamento: 2 giugno 2026 (post-completamento integrazione).

## 1. Obiettivo

WhatsApp funziona **in parallelo all'email**: per ogni evento il sistema invia su email
e/o WhatsApp a seconda di telefono + consenso del cliente. Tono WhatsApp informale.
Primo rilascio: notifiche transazionali verso clienti **stagionali**.

## 2. Flusso/eventi (3 messaggi automatici)

1. **Invito** — gestore invita il cliente; link per creare la password.
2. **Benvenuto** — quando il cliente completa la registrazione (`auth.js`).
3. **Sub-affitto confermato** — quando il gestore conferma un sub-affitto: periodo
   + credito guadagnato + credito totale.

WhatsApp è un dispatcher fire-and-forget accanto a `inviaEmail`. L'errore WA non blocca
mai email o flusso DB.

## 3. Architettura attuale (post-decisione gestione centralizzata)

**Gestione centralizzata da admin** (Matteo). I gestori non personalizzano i messaggi;
vedono solo lo stato e l'eventuale storico nella loro tab. Messaggi uguali per tutti.

- **Edge Function `invia-whatsapp`** (`supabase/functions/invia-whatsapp/index.ts`):
  - Credenziali e Content SID **da env var** (Supabase secrets) — niente tabella DB
    modificabile da UI.
  - Riceve `{ tipo, stabilimento_id, cliente_id, ...params }`. Fa lookup autonomo da
    DB di nome/telefono/consenso del cliente e `wa_enabled` dello stabilimento. Si fida
    poco del chiamante: ricontrolla tutto.
  - Skip silenzioso se `wa_enabled=false`, `whatsapp_consenso=false`, o telefono non
    valido E.164. Normalizza il telefono con `normalizePhone()` (default Italia).
- **Helper frontend** `inviaWhatsapp(tipo, params, stab)` in `js/utils.js`:
  fire-and-forget; si ferma client-side se `stab?.wa_enabled` è falso (evita chiamate
  inutili). Body inviato: `{ tipo, stabilimento_id, ...params }`.
- **Toggle per-stabilimento**: `stabilimenti.wa_enabled` (boolean, default false).
  È il "interruttore" che abilita le notifiche WhatsApp per uno stabilimento.
- **Consenso per-cliente**: `clienti_stagionali.whatsapp_consenso` +
  `whatsapp_consenso_at`. Gestito da anagrafica gestore (Step 5a) e scheda "Notifiche"
  dashboard stagionale (Step 5b).
- **Secret Supabase configurati**:
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WA_FROM=whatsapp:+393520426199`,
  `WA_SID_INVITO`, `WA_SID_BENVENUTO`, `WA_SID_SUBAFFITTO`.

## 4. Costi

Utility transazionali in Italia: pochi centesimi/msg. Twilio +~$0,005/msg, nessun canone.
Account paid (upgrade fatto perché trial non può registrare WhatsApp Sender). Per il
pilota: trascurabile.

## 5. Vincoli Meta

- **Template pre-approvati** (categoria Utility = approvazione veloce, di solito poche ore).
- **Opt-in obbligatorio**: consenso tracciabile prima di scrivere. Raccolto da gestore
  (Tab "Ombrelloni e clienti") e da cliente (scheda "Notifiche" dashboard stagionale).
- **250 conversazioni business-initiated / 24h** finché la business verification Meta
  non è completata (post-pilota).
- **Placeholder a inizio/fine = rifiuto automatico**: i body non possono iniziare/finire
  con `{{n}}`. I template attuali rispettano questa regola.

## 6. Numero pilota: BYON

- **eSIM Iliad** dedicata a nome Matteo, `+393520426199`, mai usata su WhatsApp prima,
  riceve SMS/voce per OTP.
- Account Twilio paid (Active).
- Sender registrato come WhatsApp Sender via Twilio Self Sign-up (Meta Business Portfolio
  + WABA + OTP). Display name "SpiaggiaMia".

## 7. Tab WhatsApp del gestore

Implementata dal commit `a9f85c9`. Sola lettura per il gestore:
- **Sub-tab Configurazioni → WhatsApp**: toggle `wa_enabled` per lo stabilimento,
  statistiche opt-in clienti.
- **Tab Comunicazioni → WhatsApp**: status card + tabella template informativa.

I Content SID e il numero mittente NON sono esposti al gestore (sono env var, non in DB).

## 8. Template (Content SID definitivi)

Creati nel Content Template Builder Twilio. Categoria **Utility**, lingua **Italian**.
Status template: WhatsApp business-initiated **in attesa di approvazione Meta** —
al primo invio reale verificare se sono passati ad "Approved".

1. **`spiaggiamia_invito_stagionale`** — SID `HXa6ec64d24da74f0d8348c7e180d727e8`
   (Call To Action con bottone URL)
   > Ciao {{1}}! 🏖️ {{2}} ti dà il benvenuto su SpiaggiaMia: qui gestisci il tuo ombrellone per la stagione. Crea la password per iniziare.
   - Variabili body: 1=nome, 2=stabilimento
   - Bottone URL dinamico: token invito
   - **⚠️ Da verificare al primo test reale**: la chiave della variabile URL del bottone
     è attualmente `button_1_url_0`. Se il link non è cliccabile, sostituire con `"3"`
     in `invia-whatsapp/index.ts` e ridepoylare.

2. **`spiaggiamia_benvenuto_stagionale`** — SID `HXf42d6a56208f5e790550d1e38a9f54a3` (Text)
   > Ciao {{1}}! 🌊 Il tuo account SpiaggiaMia è attivo. Segnala quando non ci sei: ogni volta che {{2}} sub-affitta il tuo ombrellone accumuli credito. Buona estate!
   - Variabili: 1=nome, 2=stabilimento

3. **`spiaggiamia_subaffitto_confermato`** — SID `HXa9170abc05f727eab8fbd4cfa253779b` (Text)
   > Ciao {{1}}! ☂️ Buone notizie: il tuo ombrellone è stato affittato {{2}}. Da {{5}} hai guadagnato {{3}} di credito, per un totale di {{4}}. Buona estate!
   - Variabili: 1=nome, 2=periodo, 3=credito guadagnato, 4=credito totale, 5=stabilimento

## 9. Storia delle decisioni architetturali

Il percorso è stato non lineare. Inizialmente si era valutata una tabella `whatsapp_config`
modificabile dal gestore via tab. Dopo la decisione di Matteo di centralizzare la gestione
("i messaggi sono uguali per tutti, non personalizzabili dai gestori"), si è scelto:

- **Content SID e numero mittente → env var**, non in DB
- **Tabella `whatsapp_config` → DROPPATA** (era stata creata nelle iterazioni precedenti
  ma resa orfana dalla scelta finale; cleanup via migration `20260602000001`)
- **Tab gestore → sola lettura**: vede solo stato `wa_enabled` e contatori opt-in

In produzione era temporaneamente in uso una versione divergente broken (`.eq("id", true)`
su uuid). Ridepoylata la versione corretta di `origin/main` (v5 ACTIVE).

## 10. STATO DEGLI STEP (tutto completato salvo test reale)

- [x] **0. Strategia / provider Twilio / architettura** — definite (incluso pivot env var)
- [x] **1. Migration consenso** — `whatsapp_consenso` + `whatsapp_consenso_at` su `clienti_stagionali`
- [x] **5a. Consenso in anagrafica gestore** — checkbox nel form modifica cliente + E.164
- [x] **5b. Preferenze dashboard stagionale** — scheda "Notifiche" con numero + opt-in/revoca
- [x] **2. Setup Twilio** — account paid, Sandbox testata, secret configurati
- [x] **2b. WhatsApp Sender BYON** — eSIM Iliad `+393520426199`, registrato e ONLINE
- [x] **3. Template** — 3 template creati con Content SID (vedi §8)
- [x] **4a. Tab WhatsApp gestore** — sub-tab Configurazioni + tab Comunicazioni (sola lettura)
- [x] **4b. Edge Function `invia-whatsapp`** — v5 ACTIVE in produzione, codice `origin/main`
- [x] **4b-bis. Agganci agli eventi** — tutti e 4 completi:
  - Invito via import Excel (`clienti.js → confirmImportaExcelExecute`)
  - Invito via bulk invite (`clienti.js → confirmBulkInvite`)
  - Benvenuto (`auth.js → completeInviteRegistration`)
  - Sub-affitto confermato (`manager.js`, con fix bug latente raccolta date)
- [x] **Cleanup `whatsapp_config`** — migration drop applicata, tabella eliminata dal DB
- [ ] **Test reale end-to-end** — pronto, manca solo `wa_enabled=true` su uno stabilimento
- [ ] **6. Produzione post-pilota** — business verification Meta per superare 250 conv/24h

## 11. UUID stabilimenti (per il test)

| Nome | UUID | wa_enabled |
|------|------|------------|
| dede | `5f0cf433-eaf7-4b8b-9da6-a87d972abdda` | false |
| Universo | `2c82f99e-992e-4935-9aa7-9d0bd94d9799` | false |

## 12. Come testare

```sql
-- 1. Abilita WhatsApp per uno stabilimento di test
UPDATE stabilimenti SET wa_enabled = true 
WHERE id = '5f0cf433-eaf7-4b8b-9da6-a87d972abdda';

-- 2. Verifica che un cliente test abbia telefono valido e consenso
SELECT id, nome, telefono, whatsapp_consenso 
FROM clienti_stagionali 
WHERE stabilimento_id = '5f0cf433-eaf7-4b8b-9da6-a87d972abdda' 
  AND whatsapp_consenso = true 
  AND telefono IS NOT NULL;
```

Poi: lancia un invito / completa una registrazione / conferma un sub-affitto. Verifica
gli esiti nei log Supabase Edge Functions (`invia-whatsapp`).

Cose da osservare al primo test:
- Il template arriva al destinatario? Se no, controllare lo stato di approvazione Meta
  dei template (potrebbero essere ancora pending business-initiated).
- L'invito ha il link cliccabile nel bottone? Se no, fix chiave bottone `button_1_url_0`
  → `"3"` in `invia-whatsapp/index.ts` e rideploy.
- I dati nelle variabili sono corretti (nome, periodo, importi)?

## 13. Riprendere da qui

Quando riapri una chat: leggere questo file con `get_file_contents` per essere allineati.
La configurazione WhatsApp è **completa e pronta al test**. Manca solo l'esecuzione del
test reale e l'eventuale fix del bottone invito. Tutto il resto è in main e deployato.
