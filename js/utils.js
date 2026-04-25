function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
function showLoading() { document.getElementById('loading-overlay').style.display = 'flex'; }

// Normalize <input type="date"> UX across browsers via flatpickr (Safari <14.1
// shipped without a native date picker; even modern Safari diverges from
// Chrome/Edge/Firefox). Keeps the underlying value as ISO "YYYY-MM-DD" so
// existing onchange handlers that read .value keep working.
function enhanceDateInputs(root) {
  if (typeof flatpickr === 'undefined') return;
  const scope = root || document;
  const inputs = scope.querySelectorAll('input[type="date"]:not([data-fp-enhanced])');
  inputs.forEach(input => {
    input.setAttribute('data-fp-enhanced', '1');
    flatpickr(input, {
      locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      allowInput: true,
      disableMobile: true,
    });
  });
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function togglePasswordVisibility(btn) {
  const wrap = btn.closest('.password-wrap');
  if (!wrap) return;
  const input = wrap.querySelector('input');
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.classList.toggle('is-visible', !showing);
  btn.setAttribute('aria-label', showing ? 'Mostra password' : 'Nascondi password');
  btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
}

function showAlert(containerId, msg, type) {
  if (!containerId) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  if (type === 'success') setTimeout(() => { el.innerHTML = ''; }, 3000);
}

function coinName(stab) {
  const nome = stab?.nome || (typeof currentStabilimento !== 'undefined' ? currentStabilimento?.nome : null);
  return nome ? `${nome}Coin` : 'Coin';
}

function formatCoin(amount, stab) {
  return `${parseFloat(amount || 0).toFixed(2)} ${coinName(stab)}`;
}

function refreshCoinLabels(stab) {
  const unit = coinName(stab);
  document.querySelectorAll('[data-coin-label]').forEach(el => {
    const base = el.dataset.coinLabel;
    el.textContent = `${base} (${unit})`;
  });
}

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayStr() {
  return toLocalDateStr(new Date());
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(str) {
  if (!str) return '';
  const d = new Date(str);
  const today = new Date();
  const diff = Math.floor((today - d) / 86400000);
  if (diff === 0) return 'Oggi ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function substitutePlaceholders(text, data) {
  if (!text) return text;
  return text
    .replace(/\{\{\s*nome\s*\}\}/gi, data?.nome || '')
    .replace(/\{\{\s*cognome\s*\}\}/gi, data?.cognome || '')
    .replace(/\{\{\s*ombrellone\s*\}\}/gi, data?.ombrellone || '')
    .replace(/\{\{\s*importo\s*\}\}/gi, data?.importo_formatted || '')
    .replace(/\{\{\s*saldo\s*\}\}/gi, data?.saldo_formatted || '')
    .replace(/\{\{\s*stabilimento\s*\}\}/gi, data?.stabilimento_nome || '')
    .replace(/\{\{\s*nota\s*\}\}/gi, data?.nota || '');
}

async function inviaEmail(tipo, clienteData, stab, override) {
  try {
    let oggetto_custom = null, testo_custom = null;
    if (override && (override.oggetto || override.testo)) {
      oggetto_custom = override.oggetto || null;
      testo_custom = override.testo || null;
    } else if (tipo === 'benvenuto') {
      oggetto_custom = stab?.email_benvenuto_oggetto || null;
      testo_custom = stab?.email_benvenuto_testo || null;
    } else if (tipo === 'invito') {
      oggetto_custom = stab?.email_invito_oggetto || null;
      testo_custom = stab?.email_invito_testo || null;
    } else if (tipo === 'credito_accreditato') {
      oggetto_custom = stab?.email_credito_accreditato_oggetto || null;
      testo_custom = stab?.email_credito_accreditato_testo || null;
    } else if (tipo === 'credito_ritirato') {
      oggetto_custom = stab?.email_credito_ritirato_oggetto || null;
      testo_custom = stab?.email_credito_ritirato_testo || null;
    }
    const placeholderData = { ...clienteData, stabilimento_nome: stab?.nome || '' };
    oggetto_custom = substitutePlaceholders(oggetto_custom, placeholderData);
    testo_custom = substitutePlaceholders(testo_custom, placeholderData);

    const { data: { session } } = await sb.auth.getSession();
    const headers = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/invia-email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tipo,
        email: clienteData.email,
        nome: clienteData.nome,
        cognome: clienteData.cognome || '',
        ombrellone: clienteData.ombrellone || null,
        invite_link: clienteData.invite_link || null,
        login_link: clienteData.login_link || null,
        importo_formatted: clienteData.importo_formatted || null,
        saldo_formatted: clienteData.saldo_formatted || null,
        nota: clienteData.nota || null,
        stabilimento_id: stab?.id || null,
        stabilimento_nome: stab?.nome || '',
        stabilimento_telefono: stab?.telefono || '',
        stabilimento_email: stab?.email || '',
        oggetto_custom,
        testo_custom,
      })
    });
    const data = await res.json();
    if (!res.ok) { console.error(`Email ${tipo} fallita:`, data); return false; }
    if (data?.warning) console.warn(`Email ${tipo}:`, data.warning);
    else console.log(`Email ${tipo} inviata:`, data);
    return true;
  } catch (e) {
    console.error(`Email ${tipo} eccezione:`, e);
    return false;
  }
}
