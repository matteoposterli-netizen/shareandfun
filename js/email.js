const DEFAULT_EMAIL_TEMPLATES = {
  invito_oggetto: "Ciao {{nome}}, la spiaggia ti aspetta! ☀️",
  invito_testo:
    "Quest'anno gestiamo gli ombrelloni con SpiaggiaMia: una piattaforma semplice per mettere a disposizione il tuo ombrellone nei giorni in cui non vieni in spiaggia, accumulando crediti da spendere al bar o al ristorante.\n\n" +
    "Il tuo posto è l'ombrellone {{ombrellone}} — abbiamo già pre-compilato i tuoi dati, ti basta un clic per confermare la registrazione.\n\n" +
    "Non vediamo l'ora di rivederti sotto il sole! ☂️",
  benvenuto_oggetto: "Benvenuto {{nome}}, la tua estate con noi inizia qui ☀️",
  benvenuto_testo:
    "Sei ufficialmente dei nostri! 🎉 Da adesso puoi mettere a disposizione il tuo ombrellone nei giorni in cui non vieni in spiaggia: ogni sub-affitto ti regala crediti da spendere al bar o al ristorante. Accedi, scegli le date libere e lascia fare a noi. Buona stagione!",
  credito_accreditato_oggetto: "⭐ {{importo}} accreditati — la spiaggia ti ringrazia!",
  credito_accreditato_testo:
    "Ciao {{nome}}! 🌊\n\n" +
    "Abbiamo appena accreditato {{importo}} sul tuo saldo. Il tuo nuovo saldo è {{saldo}}.\n\n" +
    "Puoi spenderli quando vuoi al bar o al ristorante. Buona estate! ☀️",
  credito_ritirato_oggetto: "🧾 Hai utilizzato {{importo}} — {{stabilimento}}",
  credito_ritirato_testo:
    "Ciao {{nome}}!\n\n" +
    "Abbiamo registrato l'utilizzo di {{importo}} dal tuo saldo. Ti restano {{saldo}}.\n\n" +
    "Grazie, e a presto sotto l'ombrellone! ☂️",
  chiusura_stagione_oggetto: "🌅 La stagione è finita — grazie {{nome}}!",
  chiusura_stagione_testo:
    "Ciao {{nome}}! 🌊\n\n" +
    "La stagione su {{stabilimento}} è ufficialmente conclusa: il tuo account su SpiaggiaMia non sarà più attivo fino alla riapertura della prossima stagione.\n\n" +
    "Grazie per averci accompagnato! Ci vediamo l'estate prossima sotto l'ombrellone. ☂️",
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
  const preview = document.getElementById('preview-' + id);
  if (preview) preview.textContent = document.getElementById('email-' + id).value;
}

async function loadEmailTemplates() {
  if (!currentStabilimento) return;
  const { data: stab } = await sb.from('stabilimenti')
    .select('email_benvenuto_oggetto,email_benvenuto_testo,email_invito_oggetto,email_invito_testo,email_credito_accreditato_oggetto,email_credito_accreditato_testo,email_credito_ritirato_oggetto,email_credito_ritirato_testo,email_chiusura_stagione_oggetto,email_chiusura_stagione_testo')
    .eq('id', currentStabilimento.id).single();
  if (!stab) return;
  const fields = ['benvenuto-oggetto','benvenuto-testo','invito-oggetto','invito-testo','credito-accreditato-oggetto','credito-accreditato-testo','credito-ritirato-oggetto','credito-ritirato-testo','chiusura-stagione-oggetto','chiusura-stagione-testo'];
  const keys = ['email_benvenuto_oggetto','email_benvenuto_testo','email_invito_oggetto','email_invito_testo','email_credito_accreditato_oggetto','email_credito_accreditato_testo','email_credito_ritirato_oggetto','email_credito_ritirato_testo','email_chiusura_stagione_oggetto','email_chiusura_stagione_testo'];
  const defaults = ['benvenuto_oggetto','benvenuto_testo','invito_oggetto','invito_testo','credito_accreditato_oggetto','credito_accreditato_testo','credito_ritirato_oggetto','credito_ritirato_testo','chiusura_stagione_oggetto','chiusura_stagione_testo'];
  const maxes = [80,500,80,500,80,500,80,500,80,500];
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
    email_credito_accreditato_oggetto: document.getElementById('email-credito-accreditato-oggetto').value,
    email_credito_accreditato_testo: document.getElementById('email-credito-accreditato-testo').value,
    email_credito_ritirato_oggetto: document.getElementById('email-credito-ritirato-oggetto').value,
    email_credito_ritirato_testo: document.getElementById('email-credito-ritirato-testo').value,
    email_chiusura_stagione_oggetto: document.getElementById('email-chiusura-stagione-oggetto').value,
    email_chiusura_stagione_testo: document.getElementById('email-chiusura-stagione-testo').value,
  }).eq('id', currentStabilimento.id);
  showAlert('email-save-alert', error ? error.message : 'Template email salvati con successo!', error ? 'error' : 'success');
  if (!error) {
    const { data } = await sb.from('stabilimenti').select('*').eq('id', currentStabilimento.id).single();
    if (data) currentStabilimento = data;
  }
}
