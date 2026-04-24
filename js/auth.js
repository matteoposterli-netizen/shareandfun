async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login');
  if (!email || !password) { showAlert('login-alert', 'Compila tutti i campi', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Accesso in corso...';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showAlert('login-alert', 'Email o password errati', 'error'); btn.disabled = false; btn.textContent = 'Accedi'; return; }
  currentUser = data.user;
  await loadUserAndRoute();
  btn.disabled = false; btn.textContent = 'Accedi';
}

async function doRegister() {
  const nome = document.getElementById('reg-nome').value.trim();
  const cognome = document.getElementById('reg-cognome').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const telefono = document.getElementById('reg-telefono').value.trim();
  const password = document.getElementById('reg-password').value;
  const btn = document.getElementById('btn-register');
  if (!nome || !cognome || !email || !password) { showAlert('register-alert', 'Compila tutti i campi obbligatori', 'error'); return; }
  if (password.length < 6) { showAlert('register-alert', 'La password deve avere almeno 6 caratteri', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Registrazione...';
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) { showAlert('register-alert', error.message, 'error'); btn.disabled = false; btn.textContent = 'Crea account'; return; }
  currentUser = data.user;
  const { error: pe } = await sb.from('profiles').insert({ id: currentUser.id, nome, cognome, telefono, ruolo: 'proprietario' });
  if (pe) { showAlert('register-alert', pe.message, 'error'); btn.disabled = false; btn.textContent = 'Crea account'; return; }
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  updateNav();
  showView('setup');
  btn.disabled = false; btn.textContent = 'Crea account';
}

async function doForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  const btn = document.getElementById('btn-forgot');
  if (!email) { showAlert('forgot-alert', 'Inserisci la tua email', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Invio in corso...';
  const redirectTo = `${window.location.origin}${window.location.pathname}?reset=1`;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  btn.disabled = false; btn.textContent = 'Invia link di recupero';
  if (error) { showAlert('forgot-alert', error.message || 'Errore durante l’invio dell’email', 'error'); return; }
  showAlert('forgot-alert', 'Se l’email è registrata, riceverai a breve un link per reimpostare la password. Controlla anche lo spam.', 'success');
  document.getElementById('forgot-email').value = '';
}

async function doResetPassword() {
  const pwd = document.getElementById('reset-password').value;
  const pwd2 = document.getElementById('reset-password2').value;
  const btn = document.getElementById('btn-reset');
  if (pwd.length < 6) { showAlert('reset-alert', 'La password deve avere almeno 6 caratteri', 'error'); return; }
  if (pwd !== pwd2) { showAlert('reset-alert', 'Le password non coincidono', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Aggiornamento...';
  const { data, error } = await sb.auth.updateUser({ password: pwd });
  btn.disabled = false; btn.textContent = 'Aggiorna password';
  if (error) { showAlert('reset-alert', error.message || 'Errore durante l’aggiornamento della password', 'error'); return; }
  showAlert('reset-alert', 'Password aggiornata. Accesso in corso...', 'success');
  window.history.replaceState({}, '', window.location.pathname);
  currentUser = data.user;
  await loadUserAndRoute();
}

async function doLogout() {
  await sb.auth.signOut();
  currentUser = null; currentProfile = null; currentStabilimento = null;
  updateNav();
  showView('landing');
}

async function showInvitoView(token) {
  const { data, error } = await sb.rpc('get_cliente_by_invito_token', { p_token: token });
  if (error || !data || data.length === 0) {
    showView('landing');
    alert('Link di invito non valido o già utilizzato.');
    return;
  }
  currentInviteData = data[0];
  document.getElementById('invito-title').textContent = `Benvenuto, ${currentInviteData.nome}!`;
  document.getElementById('invito-sub').textContent = `Sei stato invitato da ${currentInviteData.stabilimento_nome}. Imposta la tua password per accedere.`;
  const rows = [
    `<div style="font-weight:600;color:var(--text-dark);margin-bottom:8px">${currentInviteData.nome} ${currentInviteData.cognome}</div>`,
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">📧 <span>${currentInviteData.email}</span></div>`,
  ];
  if (currentInviteData.telefono) rows.push(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">📞 <span>${currentInviteData.telefono}</span></div>`);
  rows.push(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">🏖️ <span>${currentInviteData.stabilimento_nome}</span></div>`);
  if (currentInviteData.ombrellone_fila) rows.push(`<div style="display:flex;align-items:center;gap:8px">☂️ <span>Ombrellone: Fila ${currentInviteData.ombrellone_fila} N°${currentInviteData.ombrellone_numero}</span></div>`);
  document.getElementById('invito-info').innerHTML = rows.join('');
  document.getElementById('invito-password').value = '';
  document.getElementById('invito-password2').value = '';
  showView('invito');
}

async function completeInviteRegistration() {
  if (!currentInviteData || !currentInviteToken) return;
  const pwd = document.getElementById('invito-password').value;
  const pwd2 = document.getElementById('invito-password2').value;
  if (pwd.length < 6) { showAlert('invito-alert', 'La password deve avere almeno 6 caratteri', 'error'); return; }
  if (pwd !== pwd2) { showAlert('invito-alert', 'Le password non coincidono', 'error'); return; }
  const btn = document.getElementById('btn-invito');
  btn.disabled = true; btn.textContent = 'Registrazione in corso...';
  const { data, error } = await sb.auth.signUp({ email: currentInviteData.email, password: pwd });
  if (error) { showAlert('invito-alert', error.message, 'error'); btn.disabled = false; btn.textContent = 'Accedi a SpiaggiaMia →'; return; }
  currentUser = data.user;
  await sb.from('profiles').insert({ id: currentUser.id, nome: currentInviteData.nome, cognome: currentInviteData.cognome, ruolo: 'stagionale' });
  await sb.rpc('completa_registrazione_invito', { p_token: currentInviteToken, p_user_id: currentUser.id });
  const { data: stab } = await sb.from('stabilimenti').select('nome,telefono,email,email_benvenuto_oggetto,email_benvenuto_testo').eq('id', currentInviteData.stabilimento_id).single();
  const ombLabel = currentInviteData.ombrellone_fila ? `Fila ${currentInviteData.ombrellone_fila} N°${currentInviteData.ombrellone_numero}` : null;
  await inviaEmail('benvenuto', { email: currentInviteData.email, nome: currentInviteData.nome, cognome: currentInviteData.cognome, ombrellone: ombLabel, login_link: window.location.origin }, stab);
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  updateNav();
  window.history.replaceState({}, '', '/');
  await loadStagionaleData();
  showView('stagionale');
  btn.disabled = false;
}
