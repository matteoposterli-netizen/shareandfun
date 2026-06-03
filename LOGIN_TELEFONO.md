# LOGIN CON EMAIL O TELEFONO

Documento di stato del cambio "login con email O telefono" per
i clienti stagionali di SpiaggiaMia.

## Obiettivo
Permettere ai clienti stagionali di accedere indistintamente con
email o numero di telefono. Alcuni clienti italiani usano molto
WhatsApp e poco email, quindi devono poter fare tutto con il solo
telefono.

## Modello tecnico
- Ogni cliente registrato = 1 utente auth.users (email + password)
- Se ha email reale: va in auth.users.email
- Se ha solo telefono: email sintetica `<E164_senza_+>@phone.spiaggiamia.it`
- `clienti_stagionali.telefono` sempre normalizzato in E.164 (+39...)
- Login form unico: campo "Email o telefono" + password
  - Se l'input contiene `@` → login email diretto
  - Altrimenti → RPC `risolvi_login_da_telefono` per ottenere
    l'email auth associata, poi `signInWithPassword`
- Recupero password (opzione B confermata):
  - Ramo email → `sb.auth.resetPasswordForEmail()` (lato client)
  - Ramo telefono → Edge Function `recupero-password` che genera
    `auth.admin.generateLink({type:'recovery'})` e invia via
    WhatsApp con template "recupero_password" (in attesa Meta)
  - Risposta sempre generica per evitare enumeration

## Stato per fase

### Fase 1 — Backend ✅ (questa PR)
- [x] SQL migration `20260603120000_login_email_o_telefono.sql`:
  - helper `_normalize_phone_e164(text)`
  - trigger auto-normalizzazione su `clienti_stagionali.telefono`
  - normalizzazione one-shot record esistenti
  - unique index parziale `uniq_telefono_clienti_registrati`
  - RPC `risolvi_login_da_telefono(text) -> text`
  - RPC `rigenera_invito_token(uuid) -> uuid`
- [x] SQL migration `20260603130000_login_telefono_hardening.sql`
      (post-advisor): `SET search_path = public` sui due helper,
      `REVOKE EXECUTE FROM PUBLIC/anon` su `rigenera_invito_token`
      (solo `authenticated`), pulizia telefoni `''` → NULL.
- [x] Edge Function nuova `recupero-password`
- [x] Estensione `invia-whatsapp` per tipo `recupero_password`
- [ ] **TODO esterno**: creare e sottomettere a Meta il template
      WhatsApp "recupero_password" (utility). Quando approvato,
      configurare env var `WA_SID_RECUPERO` su Supabase.
- [x] **Hardening sicurezza pre-merge**: il tipo `recupero_password`
      di `invia-whatsapp` accetta SOLO chiamate con service-role key
      (chiusura vettore phishing scoperto in review). Vedi commit
      di hardening sulla PR #100.

### Fase 2 — Frontend login + recupero + registrazione (FATTO)
- [x] Form login con campo combinato "email o telefono"
- [x] Pagina forgot password con campo combinato
- [x] Pagina invito: mostra sempre il telefono (con "(non impostato)"
  se manca, in sola lettura)
- [x] Helper JS `isEmailLike()`, `emailSinteticaDaTelefono()`
- [x] File coinvolti: `index.html`, `js/auth.js`, `js/utils.js`
- PR `feat/login-email-telefono-fase2-frontend`. Deployata automaticamente via Vercel al merge.
- [x] Hotfix post-merge: CORS uniformato su `invia-whatsapp`
      e `invia-email` (Allow-Origin in tutte le response, non
      solo nel preflight); rollback in `completeInviteRegistration`
      se la RPC `completa_registrazione_invito` o l'insert
      `profiles` fallisce (evita orfani auth.users senza
      segnalazione all'utente).
- [x] Hotfix bulk-invite + import Excel: inviaWhatsapp ora
      ritorna `{ ok, skipped?, error? }` (retrocompatibile);
      `confirmBulkInvite` e il blocco `if (inviaInviti)` di
      `confirmImportaExcelExecute` ora tentano tutti i canali
      applicabili e contano "inviato" se almeno UNO ha
      funzionato. Sblocca l'invio WA per clienti senza email
      (caso introdotto dalla Fase 2).

### Fase 3 — Manager UI (Menu contestuale ⋮ + reset password) ✅

#### Backend
- [x] Edge Function `richiedi-reset-cliente`: input
      `{ cliente_id, canale }`; verifica ownership manager
      (`proprietario_id` == `auth.uid()`); genera recovery link via
      Admin API `generateLink({type:'recovery'})`; invia su email
      (server-to-server a `invia-email`) o WhatsApp (riusa
      `invia-whatsapp` tipo `recupero_password`). Risposta
      dettagliata (no generic anti-enumeration: auth + ownership
      proteggono gia').
- [x] Tipo `reset_password` aggiunto a `invia-email` con template
      HTML + CTA "Imposta nuova password" (campo `recovery_link`).

#### Frontend
- [x] Bottone ⋮ contestuale al posto di "[Invita]" nella tabella
      "Ombrelloni e Clienti" (`js/manager.js openClienteActionMenu`)
- [x] Popover inline con azioni dinamiche basate su stato cliente:
      - non-registrato: Copia link · Invia invito email/WA · Rigenera
      - registrato: Reset password email/WA
- [x] Voci disabilitate con tooltip per casi: no email, no telefono,
      no consenso WA, wa_disabled, email sintetica
- [x] Bulk modale unificato: selezione mista invito/reset auto-split,
      2 categorie di destinatari con badge INVITO/RESET, conteggi
      separati nel summary (`bulk-dest-breakdown`)
- [x] Helper `richiediResetCliente(clienteId, canale)` in `js/utils.js`
- File coinvolti: `js/manager.js`, `js/clienti.js`, `js/utils.js`,
  `styles.css`, `index.html`

## Note operative
- Database UNICO di produzione (`btnyzzpibedkslhtiizu`).
- Le migration richiedono conferma esplicita di Matteo prima di
  `supabase db push`.
- Template WhatsApp "recupero_password" NON ancora approvato da
  Meta — l'Edge Function gestisce gracefully il caso template
  mancante (ritorna `skipped` senza errore).
- La env var del nuovo template segue la convenzione esistente
  (`WA_SID_INVITO`/`WA_SID_BENVENUTO`/`WA_SID_SUBAFFITTO`) e si
  chiama `WA_SID_RECUPERO` (non `WHATSAPP_TEMPLATE_RECUPERO_SID`).
- La Edge Function `invia-whatsapp` con `tipo=recupero_password`
  rifiuta (HTTP 403) qualsiasi chiamata che non sia server-to-server
  con service-role key. L'unico chiamante legittimo e' la Edge
  Function `recupero-password`.
- Le Edge Function `invia-whatsapp` e `invia-email` rispondono
  con `Access-Control-Allow-Origin: *` su ogni response (POST
  e preflight). Sicuro: response non contengono dati sensibili,
  autenticazione resta garantita dal check JWT interno.

## Compatibilità
- I 103 clienti esistenti hanno tutti email vera → zero impatto
  sul loro flusso di login attuale.
- Il trigger normalizza automaticamente i telefoni vecchi anche
  se erano in formato libero.
