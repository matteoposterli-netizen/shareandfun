function showView(viewId, sub) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + viewId).classList.add('active');
  if (viewId === 'auth' && sub) toggleAuth(sub);
}

function goHome() {
  if (currentUser) {
    if (currentProfile?.ruolo === 'proprietario') showView('manager');
    else showView('stagionale');
  } else showView('landing');
}

function toggleAuth(mode) {
  const sections = ['login', 'register', 'forgot', 'reset'];
  const target = sections.includes(mode) ? mode : 'login';
  sections.forEach(s => {
    const el = document.getElementById('auth-' + s);
    if (!el) return;
    el.classList.toggle('hidden', s !== target);
  });
}

async function loadUserAndRoute() {
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  updateNav();
  if (!profile) {
    // Admin session (no business profile) → bounce to admin area.
    const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', currentUser.id).maybeSingle();
    if (adminRow) { window.location.href = '/?admin=1'; return; }
    showView('auth', 'register'); return;
  }
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
