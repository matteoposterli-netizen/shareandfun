async function doLogin() {
  const idRaw = document.getElementById('login-identifier').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login');
  if (!idRaw || !password) {
    showAlert('login-alert', 'Compila tutti i campi', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Accesso in corso...';

  // Disambiguazione: email se contiene '@', altrimenti telefono.
  // Per il telefono usiamo la RPC backend per risalire all'email
  // auth (vera o sintetica) e poi facciamo signIn con quella.
  let emailDaUsare = null;
  if (isEmailLike(idRaw)) {
    emailDaUsare = idRaw;
  } else {
    const tel = normalizzaTelefonoIT(idRaw);
    if (!tel) {
      showAlert('login-alert', 'Email o password errati', 'error');
      btn.disabled = false; btn.textContent = 'Accedi';
      return;
    }
    const { data: emailLookup, error: lookupErr } = await sb.rpc('risolvi_login_da_telefono', { p_telefono: tel });
    if (lookupErr || !emailLookup) {
      // Messaggio sempre generico per evitare enumeration
      showAlert('login-alert', 'Email o password errati', 'error');
      btn.disabled = false; btn.textContent = 'Accedi';
      return;
    }
    emailDaUsare = emailLookup;
  }

  const { data, error } = await sb.auth.signInWithPassword({ email: emailDaUsare, password });
  if (error) {
    showAlert('login-alert', 'Email o password errati', 'error');
    btn.disabled = false; btn.textContent = 'Accedi';
    return;
  }
  currentUser = data.user;
  await loadUserAndRoute();

  // Log del login SOLO per proprietari (gli stagionali non sono tracciati).
  if (currentProfile?.ruolo === 'proprietario' && currentStabilimento?.id) {
    try {
      await sb.rpc('audit_log_write', {
        p_stabilimento_id: currentStabilimento.id,
        p_entity_type: 'auth',
        p_action: 'login',
        p_description: `Login proprietario: ${emailDaUsare}`,
        p_metadata: { email: emailDaUsare, at: new Date().toISOString() },
      });
    } catch (e) { console.error('audit login failed', e); }
  }
  btn.disabled = false;
  btn.textContent = 'Accedi';
}

async function doRegister() {
  const nome = document.getElementById('reg-nome').value.trim();
  const cognome = document.getElementById('reg-cognome').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const telefono = document.getElementById('reg-telefono').value.trim();
  const password = document.getElementById('reg-password').value;
  const btn = document.getElementById('btn-register');

  if (!nome || !cognome || !email || !password) {
    showAlert('register-alert', 'Compila tutti i campi obbligatori', 'error'); return;
  }
  if (password.length < 6) {
    showAlert('register-alert', 'La password deve avere almeno 6 caratteri', 'error'); return;
  }

  btn.disabled = true; btn.textContent = 'Registrazione...';
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) {
    showAlert('register-alert', error.message, 'error');
    btn.disabled = false; btn.textContent = 'Crea account'; return;
  }

  // Caso A: email confirmation attiva → sessione non ancora disponibile
  if (!data.session) {
    // Salva i dati del form per completare la registrazione dopo la conferma email
    sessionStorage.setItem('sm_pending_reg', JSON.stringify({ nome, cognome, telefono }));
    showAlert(
      'register-alert',
      '✉️ Ti abbiamo inviato un\'email di conferma. Clicca il link per attivare il tuo account e verrai guidato alla configurazione del tuo stabilimento.',
      'success'
    );
    btn.disabled = false; btn.textContent = 'Crea account'; return;
  }

  // Caso B: email confirmation disabilitata → sessione disponibile subito
  currentUser = data.user;
  const { error: pe } = await sb.from('profiles').insert({
    id: currentUser.id, nome, cognome, telefono, ruolo: 'proprietario'
  });
  if (pe) {
    showAlert('register-alert', pe.message, 'error');
    btn.disabled = false; btn.textContent = 'Crea account'; return;
  }
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  updateNav();
  showView('setup');
  btn.disabled = false; btn.textContent = 'Crea account';
}

async function doForgotPassword() {
  const idRaw = document.getElementById('forgot-identifier').value.trim();
  const btn = document.getElementById('btn-forgot');
  if (!idRaw) {
    showAlert('forgot-alert', 'Inserisci la tua email o il numero di telefono', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Invio in corso...';

  // Ramo email: usa il flusso nativo Supabase (manda mail con link).
  // Ramo telefono: chiama la Edge Function "recupero-password" che
  // genera il magic link via Admin API e lo invia via WhatsApp.
  // In entrambi i casi mostriamo un messaggio generico al ritorno.
  try {
    if (isEmailLike(idRaw)) {
      const redirectTo = `${window.location.origin}${window.location.pathname}?reset=1`;
      const { error } = await sb.auth.resetPasswordForEmail(idRaw, { redirectTo });
      if (error) {
        // Anche su errore manteniamo un messaggio generico per
        // non rivelare l'esistenza/inesistenza dell'account.
        console.warn('resetPasswordForEmail error', error);
      }
    } else {
      const tel = normalizzaTelefonoIT(idRaw);
      if (!tel) {
        // Input non parsabile: comunque mostriamo il messaggio generico
        // per coerenza UX (l'utente capisce di aver sbagliato).
        showAlert('forgot-alert',
          'Se l\'identificativo è registrato, riceverai a breve un link per reimpostare la password. Controlla anche lo spam (se hai inserito un\'email) o WhatsApp (se hai inserito un numero).',
          'success');
        document.getElementById('forgot-identifier').value = '';
        btn.disabled = false; btn.textContent = 'Invia link di recupero';
        return;
      }
      // Chiama la Edge Function recupero-password
      const { data: { session } } = await sb.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      // Non e' necessario un JWT utente: la function accetta anon
      // (gestisce internamente la sicurezza via service-role per
      // l'invio WA, e la risposta e' sempre generica).
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/recupero-password`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ identificatore: tel, canale: 'telefono' }),
        });
      } catch (e) {
        console.warn('recupero-password fetch error', e);
      }
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Invia link di recupero';
  }

  showAlert('forgot-alert',
    'Se l\'identificativo è registrato, riceverai a breve un link per reimpostare la password. Controlla anche lo spam (se hai inserito un\'email) o WhatsApp (se hai inserito un numero).',
    'success');
  document.getElementById('forgot-identifier').value = '';
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

  // Mostriamo SEMPRE email e telefono. Se manca uno dei due, lo
  // segnaliamo esplicitamente come "(non impostato)" cosi' il cliente
  // sa di poter accedere solo con l'altro identificatore.
  const emailVal = currentInviteData.email
    ? currentInviteData.email
    : '<span style="color:var(--text-light)">(non impostata)</span>';
  const telVal = currentInviteData.telefono
    ? currentInviteData.telefono
    : '<span style="color:var(--text-light)">(non impostato)</span>';

  const rows = [
    `<div style="font-weight:600;color:var(--text-dark);margin-bottom:8px">${currentInviteData.nome} ${currentInviteData.cognome}</div>`,
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">📧 <span>${emailVal}</span></div>`,
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">📞 <span>${telVal}</span></div>`,
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">🏖️ <span>${currentInviteData.stabilimento_nome}</span></div>`,
  ];
  if (currentInviteData.ombrellone_codice) {
    rows.push(`<div style="display:flex;align-items:center;gap:8px">☂️ <span>Ombrellone: ${currentInviteData.ombrellone_codice}</span></div>`);
  }
  document.getElementById('invito-info').innerHTML = rows.join('');
  document.getElementById('invito-password').value = '';
  document.getElementById('invito-password2').value = '';
  showView('invito');
}

async function completeInviteRegistration() {
  if (!currentInviteData || !currentInviteToken) return;
  const pwd = document.getElementById('invito-password').value;
  const pwd2 = document.getElementById('invito-password2').value;
  if (pwd.length < 6) {
    showAlert('invito-alert', 'La password deve avere almeno 6 caratteri', 'error');
    return;
  }
  if (pwd !== pwd2) {
    showAlert('invito-alert', 'Le password non coincidono', 'error');
    return;
  }
  const btn = document.getElementById('btn-invito');
  btn.disabled = true; btn.textContent = 'Registrazione in corso...';

  // Determina l'email da usare per la signUp.
  let signUpEmail = currentInviteData.email || null;
  if (!signUpEmail) {
    const telE164 = currentInviteData.telefono
      ? normalizzaTelefonoIT(currentInviteData.telefono)
      : null;
    signUpEmail = emailSinteticaDaTelefono(telE164);
  }
  if (!signUpEmail) {
    showAlert('invito-alert',
      'Il tuo account non ha né email né telefono. Contatta lo stabilimento per completare i dati.',
      'error');
    btn.disabled = false; btn.textContent = 'Accedi a SpiaggiaMia →';
    return;
  }

  // 1) signUp
  let { data, error } = await sb.auth.signUp({ email: signUpEmail, password: pwd });
  if (error && /already registered/i.test(error.message || '')) {
    const { data: unblocked } = await sb.rpc('unblock_invito_email', { p_token: currentInviteToken });
    if (unblocked) {
      ({ data, error } = await sb.auth.signUp({ email: signUpEmail, password: pwd }));
    }
  }
  if (error) {
    const msg = /already registered/i.test(error.message || '')
      ? 'Questo identificativo risulta già associato a un account precedente che non è stato ripulito. Contatta lo stabilimento per sbloccare la registrazione.'
      : error.message;
    showAlert('invito-alert', msg, 'error');
    btn.disabled = false; btn.textContent = 'Accedi a SpiaggiaMia →';
    return;
  }
  currentUser = data.user;

  // Helper di rollback: usato se uno degli step successivi fallisce.
  // Slogga l'utente appena creato, prova a cancellare il profile e
  // pulire l'auth.user via unblock_invito_email (idempotente).
  const rollback = async (alertMessage) => {
    try { await sb.from('profiles').delete().eq('id', currentUser.id); } catch (e) { console.warn('rollback profile delete failed', e); }
    try { await sb.rpc('unblock_invito_email', { p_token: currentInviteToken }); } catch (e) { console.warn('rollback unblock failed', e); }
    try { await sb.auth.signOut(); } catch (e) { console.warn('rollback signOut failed', e); }
    currentUser = null; currentProfile = null;
    showAlert('invito-alert', alertMessage, 'error');
    btn.disabled = false; btn.textContent = 'Accedi a SpiaggiaMia →';
  };

  // 2) Inserimento profile
  const { error: profErr } = await sb.from('profiles').insert({
    id: currentUser.id,
    nome: currentInviteData.nome,
    cognome: currentInviteData.cognome,
    ruolo: 'stagionale',
  });
  if (profErr) {
    console.error('completeInviteRegistration: profile insert error', profErr);
    await rollback('Errore nella creazione del profilo. Riprova o contatta lo stabilimento.');
    return;
  }

  // 3) Collegamento clienti_stagionali via RPC (SECURITY DEFINER)
  // Destrutturiamo SEMPRE { data, error } cosi' che eventuali errori
  // (es. duplicate key sull'index telefono) non passino inosservati.
  const { data: rpcOk, error: rpcErr } = await sb.rpc('completa_registrazione_invito', {
    p_token: currentInviteToken,
    p_user_id: currentUser.id,
  });
  if (rpcErr || rpcOk !== true) {
    console.error('completeInviteRegistration: RPC failed', rpcErr, 'returned=', rpcOk);
    const msg = rpcErr && /duplicate key|uniq_telefono/i.test(rpcErr.message || '')
      ? 'Il numero di telefono associato al tuo invito è già in uso da un altro cliente. Contatta lo stabilimento per risolvere.'
      : 'Impossibile completare la registrazione. Contatta lo stabilimento.';
    await rollback(msg);
    return;
  }

  // 4) Notifica benvenuto (fire-and-forget, errori non bloccanti)
  const { data: stab } = await sb.from('stabilimenti')
    .select('id,nome,telefono,email,wa_enabled,email_benvenuto_oggetto,email_benvenuto_testo')
    .eq('id', currentInviteData.stabilimento_id).single();
  const ombLabel = currentInviteData.ombrellone_codice || null;
  const loginIdentifier = currentInviteData.email || currentInviteData.telefono || signUpEmail;
  const loginLink = `${window.location.origin}/?login=${encodeURIComponent(loginIdentifier)}`;

  if (currentInviteData.email) {
    inviaEmail('benvenuto', {
      email: currentInviteData.email,
      nome: currentInviteData.nome,
      cognome: currentInviteData.cognome,
      ombrellone: ombLabel,
      login_link: loginLink,
    }, stab).catch(e => console.warn('benvenuto email error (non blocking)', e));
  }
  // inviaWhatsapp gestisce internamente i casi wa_enabled/consenso/telefono
  try { inviaWhatsapp('benvenuto', { cliente_id: currentInviteData.id }, stab); } catch (e) { console.warn('benvenuto WA error (non blocking)', e); }

  // 5) Carica profile aggiornato e completa il routing
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  updateNav();
  window.history.replaceState({}, '', '/');
  await loadStagionaleData();
  showView('stagionale');
  btn.disabled = false;
}
