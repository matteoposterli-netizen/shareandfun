// js/account.js — Configurazioni → Account subtab
// Gestisce: visualizzazione/modifica profilo proprietario + cambio password + cancellazione account

/* ---------- Load profilo ---------- */

async function accountLoad() {
  if (!currentUser || !currentProfile) return;

  // Email da auth (read-only)
  const emailEl = document.getElementById('account-email');
  if (emailEl) emailEl.value = currentUser.email || '';

  // Dati da profiles
  const nomeEl = document.getElementById('account-nome');
  const cognomeEl = document.getElementById('account-cognome');
  const telefonoEl = document.getElementById('account-telefono');
  if (nomeEl) nomeEl.value = currentProfile.nome || '';
  if (cognomeEl) cognomeEl.value = currentProfile.cognome || '';
  if (telefonoEl) telefonoEl.value = currentProfile.telefono || '';

  // Reset campi password
  const pwEl = document.getElementById('account-new-password');
  const pw2El = document.getElementById('account-new-password2');
  if (pwEl) pwEl.value = '';
  if (pw2El) pw2El.value = '';

  showAlert('account-save-alert', '', '');
  showAlert('account-pw-alert', '', '');
}

/* ---------- Salva profilo ---------- */

async function accountSaveProfilo() {
  if (!currentUser) return;
  const btn = document.getElementById('btn-account-save');
  const nome = document.getElementById('account-nome').value.trim();
  const cognome = document.getElementById('account-cognome').value.trim();
  const telefono = document.getElementById('account-telefono').value.trim();

  if (!nome || !cognome) {
    showAlert('account-save-alert', 'Nome e cognome sono obbligatori.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Salvataggio…';

  const { error } = await sb.from('profiles')
    .update({ nome, cognome, telefono })
    .eq('id', currentUser.id);

  btn.disabled = false;
  btn.textContent = 'Salva modifiche';

  if (error) {
    showAlert('account-save-alert', 'Errore: ' + error.message, 'error');
    return;
  }

  currentProfile = { ...currentProfile, nome, cognome, telefono };
  showAlert('account-save-alert', '✓ Profilo aggiornato.', 'info');
  setTimeout(() => showAlert('account-save-alert', '', ''), 3000);
}

/* ---------- Cambio password ---------- */

async function accountChangePassword() {
  const btn = document.getElementById('btn-account-pw');
  const pw = document.getElementById('account-new-password').value;
  const pw2 = document.getElementById('account-new-password2').value;

  if (!pw) {
    showAlert('account-pw-alert', 'Inserisci la nuova password.', 'error');
    return;
  }
  if (pw.length < 6) {
    showAlert('account-pw-alert', 'La password deve avere almeno 6 caratteri.', 'error');
    return;
  }
  if (pw !== pw2) {
    showAlert('account-pw-alert', 'Le due password non coincidono.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Aggiornamento…';

  const { error } = await sb.auth.updateUser({ password: pw });

  btn.disabled = false;
  btn.textContent = 'Aggiorna password';

  if (error) {
    showAlert('account-pw-alert', 'Errore: ' + error.message, 'error');
    return;
  }

  document.getElementById('account-new-password').value = '';
  document.getElementById('account-new-password2').value = '';
  showAlert('account-pw-alert', '✓ Password aggiornata.', 'info');
  setTimeout(() => showAlert('account-pw-alert', '', ''), 3000);
}

/* ---------- Cancella account — modal ---------- */

function openCancellaAccountModal() {
  document.getElementById('cancella-account-input').value = '';
  document.getElementById('btn-cancella-account-confirm').disabled = true;
  showAlert('cancella-account-alert', '', '');
  document.getElementById('modal-cancella-account').classList.remove('hidden');
}

function cancellaAccountCheckMatch() {
  const val = (document.getElementById('cancella-account-input').value || '').trim();
  document.getElementById('btn-cancella-account-confirm').disabled = (val !== 'ELIMINA');
}

async function cancellaAccountExecute() {
  const val = (document.getElementById('cancella-account-input').value || '').trim();
  if (val !== 'ELIMINA') return;

  const btn = document.getElementById('btn-cancella-account-confirm');
  btn.disabled = true;
  btn.textContent = 'Eliminazione…';
  showAlert('cancella-account-alert', '', '');

  try {
    const { error } = await sb.rpc('cancella_account_proprietario');
    if (error) {
      showAlert('cancella-account-alert', 'Errore: ' + error.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Elimina definitivamente';
      return;
    }
    await sb.auth.signOut();
    window.location.href = '/';
  } catch (e) {
    showAlert('cancella-account-alert', 'Errore imprevisto: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Elimina definitivamente';
  }
}

window.accountLoad = accountLoad;
window.accountSaveProfilo = accountSaveProfilo;
window.accountChangePassword = accountChangePassword;
window.openCancellaAccountModal = openCancellaAccountModal;
window.cancellaAccountCheckMatch = cancellaAccountCheckMatch;
window.cancellaAccountExecute = cancellaAccountExecute;
