async function saveStabilimento() {
  const nome = document.getElementById('stab-nome').value.trim();
  const citta = document.getElementById('stab-citta').value.trim();
  const indirizzo = document.getElementById('stab-indirizzo').value.trim();
  const telefono = document.getElementById('stab-telefono').value.trim();
  if (!nome || !citta) { showAlert('setup1-alert', 'Nome e città sono obbligatori', 'error'); return; }
  const emailStab = document.getElementById('stab-email').value.trim();
  showLoading();
  const { data, error } = await sb.from('stabilimenti').insert({ proprietario_id: currentUser.id, nome, citta, indirizzo, telefono, email: emailStab || null }).select().single();
  if (error) { hideLoading(); showAlert('setup1-alert', error.message, 'error'); return; }
  currentStabilimento = data;
  hideLoading();

  // Ogni nuovo stabilimento nasce approvato=false, rifiutato=false (default DB)
  // e resta "in attesa" finché un admin non lo approva/rifiuta da admin.html.
  // Non entriamo nel manager: mostriamo la view "in attesa".
  showView('in-attesa');

  // Fire-and-forget: notifiche non bloccanti (non attendiamo l'esito per la UI).
  // 1) Email di benvenuto/attesa al proprietario (contenuto fisso di piattaforma).
  const nomeProprietario = (currentProfile?.nome) || nome;
  inviaEmail('stabilimento_in_attesa', {
    email: currentUser?.email || null,
    nome: nomeProprietario,
  }, data).catch(e => console.warn('email stabilimento_in_attesa (non blocking)', e));

  // 2) Notifica admin (email a Matteo + Telegram) via Edge Function dedicata.
  try {
    sb.functions.invoke('notifica-nuovo-stabilimento', {
      body: {
        stabilimento_nome: nome,
        citta,
        proprietario_nome: currentProfile?.nome || '',
        proprietario_cognome: currentProfile?.cognome || '',
        proprietario_email: currentUser?.email || '',
      },
    }).catch(e => console.warn('notifica-nuovo-stabilimento (non blocking)', e));
  } catch (e) { console.warn('notifica-nuovo-stabilimento (non blocking)', e); }
}
