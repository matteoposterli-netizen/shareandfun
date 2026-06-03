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

### Fase 2 — Frontend login + recupero + registrazione (TODO)
- Form login con campo combinato "email o telefono"
- Pagina forgot password con campo combinato
- Pagina invito: mostra sempre il telefono (con "(non impostato)"
  se manca, in sola lettura)
- Helper JS `isEmailLike()`, `emailSinteticaDaTelefono()`
- File coinvolti: `index.html`, `js/auth.js`, `js/utils.js`

### Fase 3 — Manager UI (TODO)
- Menu ⋮ per ogni riga della tabella clienti (sezione Ombrelloni
  e Clienti) con azioni:
  - Cliente non registrato (`!user_id`): Copia link invito,
    Invia invito email, Invia invito WhatsApp, Rigenera link
  - Cliente registrato (`user_id NOT NULL`): Copia link reset,
    Invia reset email, Invia reset WhatsApp
- Bulk action estesa: gestione selezione mista (registrati + non),
  label dinamica
- File coinvolti: `js/manager.js`, `js/clienti.js`, `index.html`

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

## Compatibilità
- I 103 clienti esistenti hanno tutti email vera → zero impatto
  sul loro flusso di login attuale.
- Il trigger normalizza automaticamente i telefoni vecchi anche
  se erano in formato libero.
