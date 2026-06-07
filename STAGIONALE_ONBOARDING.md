# Onboarding Cliente Stagionale — Stato e TODO

Documento di riferimento per il flusso di invito e prima registrazione del
cliente stagionale (`completeInviteRegistration` in `js/auth.js` + RPC e
vincoli su `clienti_stagionali`).

## Stato (7 giugno 2026)

- ✅ Email sintetica dal telefono (`<digits>@phone.spiaggiamia.it`) usata per
  signUp quando il cliente ha solo telefono (no email reale). Vedi
  `emailSinteticaDaTelefono` in `js/utils.js`.
- ✅ Unique `uniq_telefono_per_stabilimento_registrati` scope per stabilimento:
  consente lo stesso telefono su stabilimenti diversi (utente multi-tenant)
  e vieta duplicati nello stesso stabilimento.
  Migration: `supabase/migrations/20260607150000_uniq_telefono_per_stabilimento.sql`.
- ✅ `unblock_invito_email` gestisce il caso telefono-only: se `cs.email` è
  NULL, ricava l'email sintetica dal telefono prima di cercare e ripulire
  l'eventuale auth.user orfana.
  Migration: `supabase/migrations/20260607150001_unblock_invito_email_supporta_telefono_only.sql`.

## TODO

### 1) Riuso auth.user esistente in multi-stabilimento (PRIORITÀ ALTA)

Scenario: lo stesso cliente (telefono X) viene invitato da Stabilimento B
dopo essere già registrato in Stabilimento A. Oggi il signUp con email
sintetica `<digits>@phone.spiaggiamia.it` fallisce (`already registered`),
l'RPC `unblock_invito_email` NON rimuove l'auth.user (perché è validamente
in uso da un altro cs di Stab. A) e il cliente vede il messaggio
"identificativo già associato".

Proposta:
- In `completeInviteRegistration` (`js/auth.js`), quando il signUp fallisce
  con `already registered` e `unblock_invito_email` ritorna `false`:
  - presentare al cliente uno step "Hai già un account su SpiaggiaMia.
    Inserisci la password con cui ti registri normalmente per collegare
    questo nuovo stabilimento al tuo account."
  - tentare `signInWithPassword({ email: signUpEmail, password: pwd })`
  - in caso di successo, chiamare `completa_registrazione_invito(p_token, p_user_id=auth.uid)`
    per linkare il nuovo cs all'auth.user esistente.
- Lato sicurezza: l'azione di linkare un cs a un auth.user esistente deve
  essere consentita solo se la password viene verificata (signIn riuscito)
  e se il telefono del cs matcha il telefono già associato all'auth.user.

### 2) Rollback profile orfano via RPC SECURITY DEFINER (PRIORITÀ MEDIA)

Quando uno step di `completeInviteRegistration` fallisce dopo signUp+profile
insert, il rollback client-side fa `sb.from('profiles').delete().eq('id', uid)`
che resta a vuoto (RLS blocca il delete per ruolo `stagionale`). Risultato:
residui in `profiles` + `auth.users` orfani ad ogni tentativo fallito.

Proposta: nuova RPC `rollback_invito_registrazione(p_user_id uuid)` SECURITY
DEFINER che, con guardie equivalenti a `unblock_invito_email`, cancella
profile + auth.user dell'utente appena creato. Da chiamare dal client
nell'handler di rollback prima del `signOut()`.

### 3) UX: messaggi di errore più chiari

- Distinguere lato UI:
  - "telefono già usato nello stesso stabilimento" (errore reale di dati)
  - "telefono già registrato su un altro stabilimento" (caso multi-tenant,
    da risolvere con il punto 1)
  - "email/telefono temporaneamente bloccati per pulizia incompleta"
    (caso degli orfani, da risolvere con il punto 2)

## Pattern noti / debug rapido

- Email sintetica del telefono: `<digits-senza-+>@phone.spiaggiamia.it`,
  costruita in `emailSinteticaDaTelefono` (`js/utils.js`) e replicata in
  `unblock_invito_email` via `regexp_replace(telefono, '\D', '', 'g')`.
- FK `profiles.id` → `auth.users.id` è ON DELETE CASCADE: cancellando
  l'auth.user, il profile va via in automatico.
- Dopo un fallimento di registrazione, controllare 4 stati su DB per il
  cliente target:
  1. `auth.users` con email sintetica/reale
  2. `public.profiles` con id corrispondente
  3. `public.clienti_stagionali.user_id` = uid
  4. eventuali residui di tentativi precedenti su stesso telefono/email
