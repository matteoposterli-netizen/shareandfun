function toggleEmailSection(tipo) {
  const body = document.getElementById('email-body-' + tipo);
  body.classList.toggle('open');
}

function updateCounter(id, max) {
  const val = document.getElementById('email-' + id).value.length;
  const el = document.getElementById('counter-' + id);
  el.textContent = `${val}/${max}`;
  el.classList.toggle('warn', val > max * 0.9);
  const tipo = id.split('-')[0];
  const campo = id.split('-')[1];
  document.getElementById(`preview-${tipo}-${campo}`).textContent = document.getElementById('email-' + id).value;
}

async function loadEmailTemplates() {
  if (!currentStabilimento) return;
  const { data: stab } = await sb.from('stabilimenti').select('email_benvenuto_oggetto,email_benvenuto_testo').eq('id', currentStabilimento.id).single();
  if (!stab) return;
  const fields = ['benvenuto-oggetto','benvenuto-testo'];
  const keys = ['email_benvenuto_oggetto','email_benvenuto_testo'];
  const maxes = [80,500];
  fields.forEach((f, i) => {
    const el = document.getElementById('email-' + f);
    if (el && stab[keys[i]]) { el.value = stab[keys[i]]; updateCounter(f, maxes[i]); }
  });
}

async function saveEmailTemplates() {
  const { error } = await sb.from('stabilimenti').update({
    email_benvenuto_oggetto: document.getElementById('email-benvenuto-oggetto').value,
    email_benvenuto_testo: document.getElementById('email-benvenuto-testo').value,
  }).eq('id', currentStabilimento.id);
  showAlert('email-save-alert', error ? error.message : 'Template email salvati con successo!', error ? 'error' : 'success');
  if (!error) {
    const { data } = await sb.from('stabilimenti').select('*').eq('id', currentStabilimento.id).single();
    if (data) currentStabilimento = data;
  }
}
