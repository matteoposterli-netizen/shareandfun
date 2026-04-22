async function selectRole(r) {
  selectedRole = r;
  document.getElementById('role-proprietario').classList.toggle('selected', r === 'proprietario');
  document.getElementById('role-stagionale').classList.toggle('selected', r === 'stagionale');
  const fields = document.getElementById('reg-stagionale-fields');
  if (r === 'stagionale') {
    fields.classList.remove('hidden');
    const sel = document.getElementById('reg-stabilimento');
    sel.innerHTML = '<option value="">Caricamento...</option>';
    const { data: stabs } = await sb.from('stabilimenti').select('id, nome, citta').order('nome');
    sel.innerHTML = '<option value="">— Seleziona stabilimento —</option>' +
      (stabs || []).map(s => `<option value="${s.id}">${s.nome}${s.citta ? ' — ' + s.citta : ''}</option>`).join('');
  } else {
    fields.classList.add('hidden');
  }
}

async function onRegStabilimentoChange() {
  const stabId = document.getElementById('reg-stabilimento').value;
  const sel = document.getElementById('reg-ombrellone');
  if (!stabId) { sel.innerHTML = '<option value="">— Prima seleziona lo stabilimento —</option>'; return; }
  sel.innerHTML = '<option value="">Caricamento...</option>';
  const { data: ombs } = await sb.from('ombrelloni').select('id, fila, numero').eq('stabilimento_id', stabId).order('fila').order('numero');
  sel.innerHTML = '<option value="">— Seleziona ombrellone —</option>' +
    (ombs || []).map(o => `<option value="${o.id}">Fila ${o.fila} N°${o.numero}</option>`).join('');
}

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
  const { error: pe } = await sb.from('profiles').insert({ id: currentUser.id, nome, cognome, telefono, ruolo: selectedRole });
  if (pe) { showAlert('register-alert', pe.message, 'error'); btn.disabled = false; btn.textContent = 'Crea account'; return; }
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  updateNav();
  if (selectedRole === 'proprietario') {
    showView('setup');
  } else {
    const stabId = document.getElementById('reg-stabilimento').value;
    const ombId = document.getElementById('reg-ombrellone').value;
    if (!stabId) { showAlert('register-alert', 'Seleziona il tuo stabilimento balneare', 'error'); btn.disabled = false; btn.textContent = 'Crea account'; return; }
    if (!ombId) { showAlert('register-alert', 'Seleziona il tuo ombrellone', 'error'); btn.disabled = false; btn.textContent = 'Crea account'; return; }
    const { error: ce } = await sb.from('clienti_stagionali').insert({
      stabilimento_id: stabId, ombrellone_id: ombId, user_id: currentUser.id,
      nome, cognome, email, telefono, approvato: false, fonte: 'diretta'
    });
    if (ce) { showAlert('register-alert', ce.message, 'error'); btn.disabled = false; btn.textContent = 'Crea account'; return; }
    const { data: stab } = await sb.from('stabilimenti').select('nome,telefono,email,email_attesa_oggetto,email_attesa_testo').eq('id', stabId).single();
    await inviaEmail('attesa', { email, nome, cognome }, stab);
    showView('stagionale');
    await loadStagionaleData();
  }
  btn.disabled = false; btn.textContent = 'Crea account';
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
  const ombInfo = currentInviteData.ombrellone_fila
    ? `Ombrellone: Fila ${currentInviteData.ombrellone_fila} N°${currentInviteData.ombrellone_numero}`
    : '';
  document.getElementById('invito-info').innerHTML = `
    <strong>${currentInviteData.nome} ${currentInviteData.cognome}</strong><br>
    📧 ${currentInviteData.email}${currentInviteData.telefono ? ' · 📞 ' + currentInviteData.telefono : ''}<br>
    🏖️ ${currentInviteData.stabilimento_nome}${ombInfo ? ' · ☂️ ' + ombInfo : ''}`;
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
  if (error) { showAlert('invito-alert', error.message, 'error'); btn.disabled = false; btn.textContent = 'Accedi a ShareAndFun →'; return; }
  currentUser = data.user;
  await sb.from('profiles').insert({ id: currentUser.id, nome: currentInviteData.nome, cognome: currentInviteData.cognome, ruolo: 'stagionale' });
  await sb.rpc('completa_registrazione_invito', { p_token: currentInviteToken, p_user_id: currentUser.id });
  const { data: stab } = await sb.from('stabilimenti').select('nome,telefono,email,email_benvenuto_oggetto,email_benvenuto_testo').eq('id', currentInviteData.stabilimento_id).single();
  const ombLabel = currentInviteData.ombrellone_fila ? `Fila ${currentInviteData.ombrellone_fila} N°${currentInviteData.ombrellone_numero}` : null;
  await inviaEmail('benvenuto', { email: currentInviteData.email, nome: currentInviteData.nome, cognome: currentInviteData.cognome, ombrellone: ombLabel }, stab);
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  updateNav();
  window.history.replaceState({}, '', '/');
  await loadStagionaleData();
  showView('stagionale');
  btn.disabled = false;
}
