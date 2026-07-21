function showView(viewId, sub) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + viewId).classList.add('active');
  // Espone la view attiva come classe sul body così il CSS può adattare layout globali
  // (es. nascondere la topnav nella vista stagionale che ha un header self-contained).
  document.body.className = document.body.className.replace(/\bview-[a-z0-9-]+\b/g, '').trim();
  document.body.classList.add('view-' + viewId);
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
    // Controlla se c'è una registrazione proprietario in attesa (post email-confirmation)
    const pendingRaw = sessionStorage.getItem('sm_pending_reg');
    if (pendingRaw) {
      try {
        const { nome, cognome, telefono } = JSON.parse(pendingRaw);
        const { error: pe } = await sb.from('profiles').insert({
          id: currentUser.id, nome, cognome, telefono, ruolo: 'proprietario'
        });
        if (!pe) {
          sessionStorage.removeItem('sm_pending_reg');
          const { data: newProfile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
          currentProfile = newProfile;
          updateNav();
          showView('setup');
          return;
        }
        // Se l'insert fallisce (es. race condition) rimuovi comunque e continua
        sessionStorage.removeItem('sm_pending_reg');
      } catch (e) {
        sessionStorage.removeItem('sm_pending_reg');
      }
    }

    // Admin session (no business profile) → bounce to admin area.
    const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', currentUser.id).maybeSingle();
    if (adminRow) { window.location.href = '/?admin=1'; return; }
    showView('auth', 'register'); return;
  }
  if (profile.ruolo === 'proprietario') {
    // Gate verifica email: un proprietario auto-registrato deve confermare la
    // propria email di accesso prima di procedere. Gli account esistenti hanno
    // email_verificata=true (default colonna), quindi non sono impattati.
    if (!profile.email_verificata) { showView('verifica-email'); return; }
    const { data: stab } = await sb.from('stabilimenti').select('*').eq('proprietario_id', currentUser.id).single();
    if (!stab) { showView('setup'); return; }
    currentStabilimento = stab;
    // Gate approvazione: uno stabilimento non ancora approvato (o rifiutato) non
    // accede al manager. Lo stato di default per una nuova riga è
    // approvato=false, rifiutato=false → resta "in attesa".
    if (stab.rifiutato) { showView('rifiutato'); return; }
    if (!stab.approvato) { showView('in-attesa'); return; }
    const onboardingAttivo = await checkOnboardingMappa(currentStabilimento.id);
    if (onboardingAttivo) return;
    await loadManagerData();
    showView('manager');
  } else {
    // Dopo un reset stagione `clienti_stagionali.user_id` viene azzerato ma
    // il record auth.users resta vivo: senza questo check, il vecchio cliente
    // potrebbe ancora autenticarsi e vedere la home stagionale vuota.
    const { data: cliente } = await sb.from('clienti_stagionali')
      .select('id')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (!cliente) {
      await sb.auth.signOut();
      currentUser = null; currentProfile = null; currentStabilimento = null;
      updateNav();
      showView('auth', 'login');
      alert('Il tuo account stagionale non è più attivo: la stagione è stata chiusa dal tuo stabilimento. Per la prossima stagione riceverai un nuovo invito.');
      return;
    }
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
