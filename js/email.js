const DEFAULT_EMAIL_TEMPLATES = {
  invito_oggetto: "Ciao {{nome}}, la spiaggia ti aspetta! ☀️",
  invito_testo:
    "Ciao {{nome}}! 🌊\n\n" +
    "Quest'anno gestiamo gli ombrelloni con ShareAndFun: una piattaforma semplice per mettere a disposizione il tuo ombrellone nei giorni in cui non vieni in spiaggia, accumulando crediti da spendere al bar o al ristorante.\n\n" +
    "Il tuo posto è l'ombrellone {{ombrellone}} — abbiamo già pre-compilato i tuoi dati, ti basta un clic per confermare la registrazione.\n\n" +
    "Non vediamo l'ora di rivederti sotto il sole! ☂️",
  benvenuto_oggetto: "Benvenuto {{nome}}, la tua estate con noi inizia qui ☀️",
  benvenuto_testo:
    "Sei ufficialmente dei nostri! 🎉 Da adesso puoi mettere a disposizione il tuo ombrellone nei giorni in cui non vieni in spiaggia: ogni sub-affitto ti regala crediti da spendere al bar o al ristorante. Accedi, scegli le date libere e lascia fare a noi. Buona stagione!",
};

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
  const { data: stab } = await sb.from('stabilimenti')
    .select('email_benvenuto_oggetto,email_benvenuto_testo,email_invito_oggetto,email_invito_testo')
    .eq('id', currentStabilimento.id).single();
  if (!stab) return;
  const fields = ['benvenuto-oggetto','benvenuto-testo','invito-oggetto','invito-testo'];
  const keys = ['email_benvenuto_oggetto','email_benvenuto_testo','email_invito_oggetto','email_invito_testo'];
  const defaults = ['benvenuto_oggetto','benvenuto_testo','invito_oggetto','invito_testo'];
  const maxes = [80,500,80,500];
  fields.forEach((f, i) => {
    const el = document.getElementById('email-' + f);
    if (!el) return;
    const value = stab[keys[i]] || DEFAULT_EMAIL_TEMPLATES[defaults[i]] || '';
    if (value) { el.value = value; updateCounter(f, maxes[i]); }
  });
}

async function saveEmailTemplates() {
  const { error } = await sb.from('stabilimenti').update({
    email_benvenuto_oggetto: document.getElementById('email-benvenuto-oggetto').value,
    email_benvenuto_testo: document.getElementById('email-benvenuto-testo').value,
    email_invito_oggetto: document.getElementById('email-invito-oggetto').value,
    email_invito_testo: document.getElementById('email-invito-testo').value,
  }).eq('id', currentStabilimento.id);
  showAlert('email-save-alert', error ? error.message : 'Template email salvati con successo!', error ? 'error' : 'success');
  if (!error) {
    const { data } = await sb.from('stabilimenti').select('*').eq('id', currentStabilimento.id).single();
    if (data) currentStabilimento = data;
  }
}
