function showView(viewId, sub) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + viewId).classList.add('active');
  if (viewId === 'auth' && sub) {
    if (sub === 'login') { document.getElementById('auth-login').classList.remove('hidden'); document.getElementById('auth-register').classList.add('hidden'); }
    else { document.getElementById('auth-register').classList.remove('hidden'); document.getElementById('auth-login').classList.add('hidden'); }
  }
}

function goHome() {
  if (currentUser) {
    if (currentProfile?.ruolo === 'proprietario') showView('manager');
    else showView('stagionale');
  } else showView('landing');
}

function toggleAuth(mode) {
  if (mode === 'login') { document.getElementById('auth-login').classList.remove('hidden'); document.getElementById('auth-register').classList.add('hidden'); }
  else { document.getElementById('auth-register').classList.remove('hidden'); document.getElementById('auth-login').classList.add('hidden'); }
}

async function loadUserAndRoute() {
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  updateNav();
  if (!profile) { showView('auth', 'register'); return; }
  if (profile.ruolo === 'proprietario') {
    const { data: stab } = await sb.from('stabilimenti').select('*').eq('proprietario_id', currentUser.id).single();
    if (!stab) { showView('setup'); return; }
    currentStabilimento = stab;
    await loadManagerData();
    showView('manager');
  } else {
    showView('stagionale');
    await loadStagionaleData();
  }
}

function updateNav() {
  const nr = document.getElementById('nav-right');
  if (currentProfile) {
    nr.innerHTML = `<span class="nav-user">👋 ${currentProfile.nome}</span><button class="btn-nav" onclick="doLogout()">Esci</button>`;
  } else {
    nr.innerHTML = `<button class="btn-nav" onclick="showView('auth','login')">Accedi</button><button class="btn-nav filled" onclick="showView('auth','register')">Registrati</button>`;
  }
}
