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
  refreshCoinLabels(currentStabilimento);
  await loadManagerData();
  hideLoading();
  showView('manager');
}
