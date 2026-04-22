function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
function showLoading() { document.getElementById('loading-overlay').style.display = 'flex'; }

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showAlert(containerId, msg, type) {
  if (!containerId) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  if (type === 'success') setTimeout(() => { el.innerHTML = ''; }, 3000);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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

async function inviaEmail(tipo, clienteData, stab) {
  try {
    await sb.functions.invoke('invia-email', {
      body: {
        tipo,
        email: clienteData.email,
        nome: clienteData.nome,
        cognome: clienteData.cognome || '',
        ombrellone: clienteData.ombrellone || null,
        invite_link: clienteData.invite_link || null,
        stabilimento_nome: stab?.nome || '',
        stabilimento_telefono: stab?.telefono || '',
        stabilimento_email: stab?.email || '',
        oggetto_custom: tipo === 'benvenuto' ? stab?.email_benvenuto_oggetto : tipo === 'attesa' ? stab?.email_attesa_oggetto : tipo === 'approvazione' ? stab?.email_approvazione_oggetto : null,
        testo_custom: tipo === 'benvenuto' ? stab?.email_benvenuto_testo : tipo === 'attesa' ? stab?.email_attesa_testo : tipo === 'approvazione' ? stab?.email_approvazione_testo : null,
      }
    });
  } catch (e) {
    console.warn('Errore invio email:', e);
  }
}
