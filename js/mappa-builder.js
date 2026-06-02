// ===== MAPPA BUILDER =====
// Visual builder for beach umbrella layout during onboarding

const MAPPA_COLS = 20;
const MAPPA_ROWS = 20;
const CELL_TIPO = { OMBRELLONE: 'ombrellone', PASSERELLA: 'passerella', VUOTO: 'vuoto' };

let mappaState = {
  grid: [],
  codici: {},
  ids: {},
  modalita: CELL_TIPO.OMBRELLONE,
  step: 1,
  selectedCell: null
};

let _mappaStabilimentoId = null;
let _mappaModalita = 'create'; // 'create' | 'edit'
let _mappaOriginalSnapshot = null;
let _cellJustCreated = false;

// Scoped root for element lookups — set to the active container (overlay body or null for the
// full-page view). Prevents document.getElementById from finding the static #view-mappa-builder
// elements when the overlay injects HTML with the same IDs into builder-overlay-body.
let _mappaContainer = null;

function _qid(id) {
  if (_mappaContainer) {
    const el = _mappaContainer.querySelector('#' + id);
    if (el) return el;
  }
  return document.getElementById(id);
}
function _qall(selector) {
  return (_mappaContainer || document).querySelectorAll(selector);
}
function _q(selector) {
  return (_mappaContainer || document).querySelector(selector);
}

// Inietta CSS per stati errore e counter (evita modifica a styles.css e index.html)
(function _injectMappaStyles() {
  if (document.getElementById('mappa-builder-styles')) return;
  const s = document.createElement('style');
  s.id = 'mappa-builder-styles';
  s.textContent = `
    .codice-row-error { background: #FDEBEA !important; border-color: #D9534F !important; }
    .codice-input-error { border-color: #D9534F !important; box-shadow: 0 0 0 2px rgba(217,83,79,0.2) !important; }
    .mappa-missing-counter {
      font-size: 12px; font-weight: 600; padding: 4px 10px;
      border-radius: 6px; display: inline-block; margin-right: 8px;
    }
    .mappa-missing-counter.has-missing { color: var(--red); background: var(--red-light); }
    .mappa-missing-counter.all-done { color: var(--green); background: var(--green-light); }
  `;
  document.head.appendChild(s);
})();

function initGrid() {
  mappaState.grid = Array.from({ length: MAPPA_ROWS }, () =>
    Array(MAPPA_COLS).fill(CELL_TIPO.VUOTO)
  );
  mappaState.codici = {};
  mappaState.ids = {};
  mappaState.toDelete = [];
  mappaState.selectedCell = null;
  mappaState.step = 1;
}

function getOmbrelloniCount() {
  return mappaState.grid.flat().filter(t => t === CELL_TIPO.OMBRELLONE).length;
}

function setModalita(tipo) {
  mappaState.modalita = tipo;
  _qall('.mode-btn').forEach(b => b.classList.remove('active'));
  const btnId = tipo === CELL_TIPO.OMBRELLONE ? 'btn-mode-ombrellone'
              : tipo === CELL_TIPO.PASSERELLA ? 'btn-mode-passerella'
              : tipo === CELL_TIPO.VUOTO ? 'btn-mode-vuoto'
              : tipo === 'modifica' ? 'btn-mode-modifica'
              : '';
  if (btnId) _qid(btnId)?.classList.add('active');
}

function updateCell(r, c) {
  const stepEl = mappaState.step === 2 ? _qid('mappa-grid-step2') : _qid('mappa-grid-step1');
  const el = stepEl ? stepEl.querySelector(`[data-r="${r}"][data-c="${c}"]`) : null;
  if (!el) return;
  const tipo = mappaState.grid[r][c];
  el.className = `mappa-cell tipo-${tipo}`;
  if (tipo === CELL_TIPO.OMBRELLONE) {
    const cod = mappaState.codici[`${r}_${c}`];
    el.textContent = cod || '';
  } else {
    el.textContent = '';
  }
}

function updateCounter() {
  const n = getOmbrelloniCount();
  const counter = _qid('mappa-counter');
  if (counter) counter.textContent = `${n} ombrelloni`;
  const btn = _qid('btn-mappa-avanti');
  if (btn) btn.disabled = n === 0;
}

function setCellTipo(r, c, tipo) {
  mappaState.grid[r][c] = tipo;
  if (tipo !== CELL_TIPO.OMBRELLONE) {
    delete mappaState.codici[`${r}_${c}`];
  }
  updateCell(r, c);
  updateCounter();
}

let _mappaDragging = false;
let _mappaDraggingActive = false;
let _mappaLastDragTipo = CELL_TIPO.OMBRELLONE;

function _addBarMareLabels(gridEl) {
  if (!gridEl || !gridEl.parentElement) return;
  const parent = gridEl.parentElement;
  parent.querySelectorAll('.mappa-bar-label, .mappa-mare-label').forEach(el => el.remove());
  const bar = document.createElement('div');
  bar.className = 'mappa-bar-label';
  bar.textContent = '— BAR —';
  parent.insertBefore(bar, gridEl);
  const mare = document.createElement('div');
  mare.className = 'mappa-mare-label';
  mare.textContent = '— MARE —';
  gridEl.insertAdjacentElement('afterend', mare);
}

// Assicura che il counter "N senza nome" esista accanto al bottone Salva
function _ensureMissingCounter() {
  if (_qid('mappa-missing-counter')) return;
  const btn = _qid('btn-mappa-salva');
  if (!btn || !btn.parentElement) return;
  const span = document.createElement('span');
  span.id = 'mappa-missing-counter';
  span.className = 'mappa-missing-counter';
  btn.parentElement.insertBefore(span, btn);
}

function _aggiornaCounterMancanti() {
  _ensureMissingCounter();
  let missing = 0;
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE) {
        const val = (mappaState.codici[`${r}_${c}`] || '').trim();
        if (!val) missing++;
      }
    }
  }
  const el = _qid('mappa-missing-counter');
  if (!el) return;
  if (missing > 0) {
    el.className = 'mappa-missing-counter has-missing';
    el.textContent = `${missing} ombrelon${missing > 1 ? 'i' : 'e'} senza nome`;
  } else {
    el.className = 'mappa-missing-counter all-done';
    el.textContent = '✓ Tutti compilati';
  }
}

function renderMappaStep1() {
  const grid = _qid('mappa-grid-step1');
  if (!grid) return;
  grid.innerHTML = '';
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      const cell = document.createElement('div');
      const tipo = mappaState.grid[r][c];
      cell.className = `mappa-cell tipo-${tipo}`;
      cell.dataset.r = r;
      cell.dataset.c = c;
      if (tipo === CELL_TIPO.OMBRELLONE) {
        const cod = mappaState.codici[`${r}_${c}`];
        cell.textContent = cod || '';
      }
      cell.addEventListener('mousedown', (e) => {
        _cellJustCreated = false;
        const currentTipo = mappaState.grid[r][c];
        if (_mappaModalita === 'edit' && currentTipo === CELL_TIPO.OMBRELLONE) {
          // Le azioni su ombrelloni esistenti in edit mode sono gestite dal click
          e.preventDefault(); // evita selezione testo durante drag
          return;
        }
        if (mappaState.modalita === 'modifica') {
          // In modalità modifica, ignora mousedown
          e.preventDefault();
          return;
        }
        const nextTipo = (currentTipo === mappaState.modalita) ? CELL_TIPO.VUOTO : mappaState.modalita;
        _mappaLastDragTipo = nextTipo;
        if (currentTipo === CELL_TIPO.VUOTO && nextTipo === CELL_TIPO.OMBRELLONE) {
          _cellJustCreated = true;
        }
        setCellTipo(r, c, nextTipo);
        _mappaDraggingActive = true;
        e.preventDefault();
      });

      cell.addEventListener('click', (e) => {
        if (_mappaModalita !== 'edit') return;
        if (mappaState.grid[r][c] !== CELL_TIPO.OMBRELLONE) return;

        // Cella appena creata in questa sessione: non mostrare popup
        if (_cellJustCreated) { _cellJustCreated = false; return; }

        e.stopPropagation();
        const codice = mappaState.codici[`${r}_${c}`] || '?';

        if (mappaState.modalita === CELL_TIPO.VUOTO) {
          // Cancella mode: elimina ombrellone
          const ombId = mappaState.ids[`${r}_${c}`];
          if (ombId) {
            _confermaRimozioneOmbrellone(ombId, codice).then(ok => {
              if (!ok) return;
              if (!mappaState.toDelete) mappaState.toDelete = [];
              mappaState.toDelete.push(ombId);
              delete mappaState.ids[`${r}_${c}`];
              delete mappaState.codici[`${r}_${c}`];
              mappaState.grid[r][c] = CELL_TIPO.VUOTO;
              updateCell(r, c);
              updateCounter();
            });
          } else {
            delete mappaState.codici[`${r}_${c}`];
            setCellTipo(r, c, CELL_TIPO.VUOTO);
          }
        } else if (mappaState.modalita === 'modifica') {
          // Modifica mode: rinomina direttamente
          const nuovo = prompt(`Rinomina ombrellone "${codice}":`, codice);
          if (nuovo !== null && nuovo.trim() !== '') {
            mappaState.codici[`${r}_${c}`] = nuovo.trim();
            updateCell(r, c);
          }
        } else {
          // Ombrellone o Passerella mode: mostra popup rinomina/elimina
          _mostraPopupCella(r, c, cell);
        }
      });
      cell.addEventListener('mouseenter', () => {
        if (_mappaDraggingActive && mappaState.modalita !== CELL_TIPO.VUOTO) {
          if (mappaState.grid[r][c] === CELL_TIPO.VUOTO) {
            setCellTipo(r, c, mappaState.modalita);
          }
        }
      });
      if (_mappaModalita === 'edit' && tipo === CELL_TIPO.OMBRELLONE) {
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', `${r},${c}`);
          e.dataTransfer.effectAllowed = 'move';
        });
      }
      cell.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/plain')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      });
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        const [fromR, fromC] = e.dataTransfer.getData('text/plain').split(',').map(Number);
        const toR = r; const toC = c;
        if (fromR === toR && fromC === toC) return;
        if (mappaState.grid[toR][toC] !== CELL_TIPO.VUOTO) return;
        mappaState.grid[toR][toC] = CELL_TIPO.OMBRELLONE;
        mappaState.codici[`${toR}_${toC}`] = mappaState.codici[`${fromR}_${fromC}`] || '';
        if (mappaState.ids[`${fromR}_${fromC}`]) {
          mappaState.ids[`${toR}_${toC}`] = mappaState.ids[`${fromR}_${fromC}`];
        }
        delete mappaState.ids[`${fromR}_${fromC}`];
        delete mappaState.codici[`${fromR}_${fromC}`];
        mappaState.grid[fromR][fromC] = CELL_TIPO.VUOTO;
        renderMappaStep1();
      });
      grid.appendChild(cell);
    }
  }
  grid.addEventListener('mouseup', () => { _mappaDraggingActive = false; });
  document.addEventListener('mouseup', () => { _mappaDraggingActive = false; }, { once: false });
  updateCounter();
  _addBarMareLabels(grid);
}

function renderMappaStep2() {
  const gridEl = _qid('mappa-grid-step2');
  if (gridEl) {
    gridEl.innerHTML = '';
    for (let r = 0; r < MAPPA_ROWS; r++) {
      for (let c = 0; c < MAPPA_COLS; c++) {
        const cell = document.createElement('div');
        const tipo = mappaState.grid[r][c];
        const cod = tipo === CELL_TIPO.OMBRELLONE ? (mappaState.codici[`${r}_${c}`] || '?') : '';
        const hasCode = tipo === CELL_TIPO.OMBRELLONE && mappaState.codici[`${r}_${c}`];
        cell.className = `mappa-cell tipo-${tipo}${tipo === CELL_TIPO.OMBRELLONE ? (hasCode ? ' has-codice' : ' missing-codice') : ''}`;
        cell.textContent = cod;
        cell.dataset.r = r;
        cell.dataset.c = c;
        if (tipo === CELL_TIPO.OMBRELLONE) {
          cell.addEventListener('click', () => selectCellStep2(r, c));
        }
        if (mappaState.selectedCell && mappaState.selectedCell.r === r && mappaState.selectedCell.c === c) {
          cell.classList.add('selected');
        }
        gridEl.appendChild(cell);
      }
    }
    _addBarMareLabels(gridEl);
  }

  const table = _qid('mappa-codici-table');
  if (table) {
    table.innerHTML = '';
    let idx = 0;
    for (let r = 0; r < MAPPA_ROWS; r++) {
      for (let c = 0; c < MAPPA_COLS; c++) {
        if (mappaState.grid[r][c] !== CELL_TIPO.OMBRELLONE) continue;
        idx++;
        const row = document.createElement('div');
        const isSelected = mappaState.selectedCell && mappaState.selectedCell.r === r && mappaState.selectedCell.c === c;
        row.className = `codice-row${isSelected ? ' selected-row' : ''}`;
        row.id = `codice-row-${r}-${c}`;
        const pos = document.createElement('span');
        pos.className = 'codice-pos';
        pos.textContent = `${idx}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'codice-input';
        input.id = `codice-input-${r}-${c}`;
        input.placeholder = `es. A${idx}`;
        input.value = mappaState.codici[`${r}_${c}`] || '';
        input.addEventListener('input', () => {
          mappaState.codici[`${r}_${c}`] = input.value;
          _aggiornaCounterMancanti();
          row.classList.remove('codice-row-error');
          input.classList.remove('codice-input-error');
          const cellEl = _q(`#mappa-grid-step2 [data-r="${r}"][data-c="${c}"]`);
          if (cellEl) {
            const cod = input.value.trim();
            cellEl.textContent = cod || '?';
            cellEl.className = `mappa-cell tipo-ombrellone ${cod ? 'has-codice' : 'missing-codice'}`;
            if (mappaState.selectedCell && mappaState.selectedCell.r === r && mappaState.selectedCell.c === c) {
              cellEl.classList.add('selected');
            }
          }
        });
        row.appendChild(pos);
        row.appendChild(input);
        table.appendChild(row);
      }
    }
  }
  _aggiornaCounterMancanti();
}

function selectCellStep2(r, c) {
  mappaState.selectedCell = { r, c };
  _qall('#mappa-grid-step2 .mappa-cell').forEach(el => el.classList.remove('selected'));
  const cellEl = _q(`#mappa-grid-step2 [data-r="${r}"][data-c="${c}"]`);
  if (cellEl) cellEl.classList.add('selected');
  _qall('.codice-row').forEach(el => el.classList.remove('selected-row'));
  const rowEl = _qid(`codice-row-${r}-${c}`);
  if (rowEl) rowEl.classList.add('selected-row');
  const input = _qid(`codice-input-${r}-${c}`);
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function goToStep2() {
  if (getOmbrelloniCount() === 0) return;
  mappaState.step = 2;
  _qid('mappa-step1-content').style.display = 'none';
  _qid('mappa-step2-content').style.display = '';
  _qid('mappa-step-1-label')?.classList.remove('active');
  _qid('mappa-step-2-label')?.classList.add('active');
  renderMappaStep2();
}

function goToStep1() {
  mappaState.step = 1;
  _qid('mappa-step2-content').style.display = 'none';
  _qid('mappa-step1-content').style.display = '';
  _qid('mappa-step-1-label')?.classList.add('active');
  _qid('mappa-step-2-label')?.classList.remove('active');
  renderMappaStep1();
}

function showMappaError(msg) {
  const el = _qid('mappa-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

function validateCodici() {
  const ombrelloni = [];
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE) {
        // Leggi dal DOM se disponibile (fonte più affidabile del valore attuale)
        const inputEl = _qid(`codice-input-${r}-${c}`);
        const val = inputEl ? inputEl.value.trim() : (mappaState.codici[`${r}_${c}`] || '').trim();
        if (val) mappaState.codici[`${r}_${c}`] = val; // sincronizza
        ombrelloni.push({ r, c, codice: val });
      }
    }
  }
  const errors = [];
  const vuoti = ombrelloni.filter(o => !o.codice);
  if (vuoti.length) {
    errors.push(`${vuoti.length} ombrelon${vuoti.length > 1 ? 'i' : 'e'} senza nome`);
    // Evidenzia in rosso + scrolla al primo mancante
    vuoti.forEach((o, idx) => {
      const rowEl = _qid(`codice-row-${o.r}-${o.c}`);
      const inputEl = _qid(`codice-input-${o.r}-${o.c}`);
      if (rowEl) rowEl.classList.add('codice-row-error');
      if (inputEl) inputEl.classList.add('codice-input-error');
      if (idx === 0 && inputEl) {
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => inputEl.focus(), 300);
      }
    });
  }
  const codiciList = ombrelloni.map(o => o.codice).filter(Boolean);
  const duplicati = codiciList.filter((v, i) => codiciList.indexOf(v) !== i);
  if (duplicati.length) errors.push(`Nomi duplicati: ${[...new Set(duplicati)].join(', ')}`);
  return errors;
}

async function salvaMappaStabilimento(stabilimentoId) {
  const errors = validateCodici();
  if (errors.length) { showMappaError(errors.join(' · ')); return; }

  const btn = _qid('btn-mappa-salva');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  showMappaError('');

  const ombrelloniData = [];
  const passerelleData = [];

  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE) {
        const inputEl = _qid(`codice-input-${r}-${c}`);
        const codice = inputEl ? inputEl.value.trim() : (mappaState.codici[`${r}_${c}`] || '').trim();
        ombrelloniData.push({
          stabilimento_id: stabilimentoId,
          codice,
          pos_x: c,
          pos_y: r,
          credito_giornaliero: 1.00
        });
      }
      if (mappaState.grid[r][c] === CELL_TIPO.PASSERELLA) {
        passerelleData.push({ x: c, y: r });
      }
    }
  }

  const { error: errOmb } = await sb.from('ombrelloni').insert(ombrelloniData);
  if (errOmb) {
    showMappaError(errOmb.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Salva mappa'; }
    return;
  }

  const { error: errStab } = await sb
    .from('stabilimenti')
    .update({ mappa_passerelle: passerelleData })
    .eq('id', stabilimentoId);
  if (errStab) {
    showMappaError(errStab.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Salva mappa'; }
    return;
  }
  if (currentStabilimento) currentStabilimento.mappa_passerelle = passerelleData;

  const inOverlay = _mappaStabilimentoId !== null &&
    document.getElementById('modal-mappa-builder') &&
    !document.getElementById('modal-mappa-builder').classList.contains('hidden');
  if (inOverlay) {
    chiudiMappaBuilderOverlay();
    await loadManagerData();
  } else {
    chiudiMappaBuilder();
    await loadManagerData();
    showView('manager');
  }
}

function mostraMappaBuilder(stabilimentoId) {
  _mappaStabilimentoId = stabilimentoId;
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.style.display = '';
  });
  document.body.className = document.body.className.replace(/\bview-[a-z0-9-]+\b/g, '').trim();
  document.body.classList.add('view-mappa-builder');
  const el = document.getElementById('view-mappa-builder');
  el.style.display = 'block';
  el.classList.add('active');
  goToStep1();
}

function chiudiMappaBuilder() {
  const el = document.getElementById('view-mappa-builder');
  el.classList.remove('active');
  el.style.display = 'none';
  document.body.classList.remove('view-mappa-builder');
  _mappaContainer = null;
  _mappaStabilimentoId = null;
}

async function checkOnboardingMappa(stabilimentoId) {
  const { count } = await sb
    .from('ombrelloni')
    .select('id', { count: 'exact', head: true })
    .eq('stabilimento_id', stabilimentoId);

  if (count === 0) {
    initGrid();
    mostraMappaBuilder(stabilimentoId);
    return true;
  }
  return false;
}

// ============================================================
// OVERLAY BUILDER — apri/chiudi, carica mappa esistente, inietta HTML
// ============================================================

async function apriMappaBuilderOverlay() {
  if (!currentStabilimento) return;
  const stabId = currentStabilimento.id;

  const { count } = await sb.from('ombrelloni')
    .select('id', { count: 'exact', head: true })
    .eq('stabilimento_id', stabId);
  const hasMappa = count > 0;

  const titleEl = document.getElementById('gestisci-mappa-title');
  const descEl = document.getElementById('gestisci-mappa-desc');
  if (titleEl) titleEl.textContent = hasMappa ? 'Modifica mappa spiaggia' : 'Crea mappa spiaggia';
  if (descEl) descEl.textContent = hasMappa
    ? 'Modifica posizioni, aggiungi o rimuovi ombrelloni e passerelle.'
    : 'Disegna visivamente la mappa degli ombrelloni e delle passerelle.';

  _mappaStabilimentoId = stabId;
  _mappaModalita = hasMappa ? 'edit' : 'create';

  initGrid();
  if (hasMappa) {
    await _caricaMappaEsistente(stabId);
  }

  _iniettaBuilderNelOverlay(_mappaModalita);
  document.getElementById('modal-mappa-builder').classList.remove('hidden');
}

function chiudiMappaBuilderOverlay() {
  document.getElementById('modal-mappa-builder').classList.add('hidden');
  document.getElementById('builder-overlay-body').innerHTML = '';
  _mappaContainer = null;
  _mappaStabilimentoId = null;
}

async function _caricaMappaEsistente(stabId) {
  const { data: ombs } = await sb.from('ombrelloni')
    .select('id,codice,pos_x,pos_y,credito_giornaliero')
    .eq('stabilimento_id', stabId);
  const passerelle = currentStabilimento?.mappa_passerelle || [];

  (ombs || []).forEach(o => {
    const r = o.pos_y ?? 0;
    const c = o.pos_x ?? 0;
    if (r < MAPPA_ROWS && c < MAPPA_COLS) {
      mappaState.grid[r][c] = CELL_TIPO.OMBRELLONE;
      mappaState.codici[`${r}_${c}`] = o.codice || '';
      mappaState.ids[`${r}_${c}`] = o.id;
    }
  });
  passerelle.forEach(p => {
    const r = p.y ?? 0;
    const c = p.x ?? 0;
    if (r < MAPPA_ROWS && c < MAPPA_COLS) {
      mappaState.grid[r][c] = CELL_TIPO.PASSERELLA;
    }
  });

  // Auto-placement: se più ombrelloni occupano la stessa cella (es. tutti a 0,0
  // dopo un import Excel), li ridistribuiamo a serpentina sulla griglia.
  const placedKeys = Object.keys(mappaState.ids);
  const uniquePlacedKeys = new Set(placedKeys);
  const totalOmbs = (ombs || []).length;
  if (totalOmbs > 1 && uniquePlacedKeys.size < totalOmbs) {
    // Reset celle ombrellone (le passerelle già caricate rimangono)
    for (let r = 0; r < MAPPA_ROWS; r++) {
      for (let c = 0; c < MAPPA_COLS; c++) {
        if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE) {
          mappaState.grid[r][c] = CELL_TIPO.VUOTO;
        }
      }
    }
    mappaState.codici = {};
    mappaState.ids = {};

    // Ordina per codice (natural sort) e piazza riga per riga saltando le passerelle
    const sorted = (ombs || []).slice().sort((a, b) =>
      (a.codice || '').localeCompare(b.codice || '', 'it', { numeric: true })
    );
    let placed = 0;
    for (let r = 0; r < MAPPA_ROWS && placed < sorted.length; r++) {
      for (let c = 0; c < MAPPA_COLS && placed < sorted.length; c++) {
        if (mappaState.grid[r][c] === CELL_TIPO.VUOTO) {
          const o = sorted[placed];
          mappaState.grid[r][c] = CELL_TIPO.OMBRELLONE;
          mappaState.codici[`${r}_${c}`] = o.codice || '';
          mappaState.ids[`${r}_${c}`] = o.id;
          placed++;
        }
      }
    }
  }

  _mappaOriginalSnapshot = {
    ombs: (ombs || []).map(o => ({ id: o.id, pos_x: o.pos_x, pos_y: o.pos_y, codice: o.codice })),
    passerelle: [...passerelle]
  };
}

function _iniettaBuilderNelOverlay(modalita) {
  const body = document.getElementById('builder-overlay-body');
  if (!body) return;

  body.innerHTML = `
    <div style="padding:20px 28px">
      ${modalita === 'edit' ? '<div class="alert alert-info" style="margin-bottom:16px;font-size:13px">☂️ <strong>Ombrellone</strong>: clicca su celle vuote per aggiungere · 🚶 <strong>Passerella</strong>: corridoi tra ombrelloni · ✕ <strong>Cancella</strong>: clicca su un ombrellone per rimuoverlo · ✏️ <strong>Modifica</strong>: clicca su un ombrellone per rinominarlo · 🖱️ <strong>Trascina</strong> un ombrellone su una cella vuota per spostarlo</div>' : ''}
      <div id="mappa-step1-content">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <button id="btn-mode-ombrellone" class="btn btn-sm mode-btn active" onclick="setModalita('ombrellone')">☂️ Ombrellone</button>
          <button id="btn-mode-passerella" class="btn btn-sm mode-btn" onclick="setModalita('passerella')">🚶 Passerella</button>
          <button id="btn-mode-vuoto" class="btn btn-sm mode-btn" onclick="setModalita('vuoto')">✕ Cancella</button>
          <button id="btn-mode-modifica" class="btn btn-sm mode-btn" onclick="setModalita('modifica')">✏️ Modifica</button>
          <span id="mappa-counter" style="font-size:13px;color:var(--text-mid);margin-left:8px">0 ombrelloni</span>
        </div>
        <div style="overflow-x:auto">
          <div class="mappa-bar-label-wrap">
            <div id="mappa-grid-step1" class="mappa-grid"></div>
          </div>
        </div>
        <div id="mappa-error" style="color:var(--red);font-size:13px;margin-top:10px;display:none"></div>
        <div style="margin-top:16px;display:flex;gap:10px">
          <button class="btn btn-outline btn-sm" onclick="chiudiMappaBuilderOverlay()">Annulla</button>
          <button id="btn-mappa-avanti" class="btn btn-primary btn-sm" onclick="goToStep2()" disabled>Avanti: Assegna nomi →</button>
        </div>
      </div>

      <div id="mappa-step2-content" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 320px;gap:24px;align-items:start">
          <div style="overflow-x:auto">
            <div id="mappa-grid-step2" class="mappa-grid"></div>
          </div>
          <div>
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">Assegna un nome a ogni ombrellone</div>
            <div id="mappa-codici-table" style="max-height:480px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm)"></div>
          </div>
        </div>
        <div id="mappa-error" style="color:var(--red);font-size:13px;margin-top:10px;display:none"></div>
        <div style="margin-top:16px;display:flex;gap:10px;align-items:center">
          <button class="btn btn-outline btn-sm" onclick="goToStep1()">← Indietro</button>
          <button id="btn-mappa-salva" class="btn btn-primary btn-sm" onclick="_onClickSalvaMappa()">Salva mappa</button>
        </div>
      </div>
    </div>
  `;

  // Point all element lookups to this overlay body so they don't resolve to the
  // same-named static elements inside #view-mappa-builder (the onboarding full-page view).
  _mappaContainer = body;
  renderMappaStep1();
}

function _mostraPopupCella(r, c, cellEl) {
  document.getElementById('mappa-cell-action-popup')?.remove();
  const codice = mappaState.codici[`${r}_${c}`] || '?';
  const popup = document.createElement('div');
  popup.id = 'mappa-cell-action-popup';
  const rect = cellEl.getBoundingClientRect();
  const top = Math.min(rect.bottom + 6, window.innerHeight - 110);
  const left = Math.min(rect.left, window.innerWidth - 160);
  popup.style.cssText = `position:fixed;z-index:10000;background:#fff;border:1px solid var(--border,#ddd);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);padding:8px;display:flex;flex-direction:column;gap:6px;min-width:140px;top:${top}px;left:${left}px`;
  popup.innerHTML = `
    <div style="font-size:11px;font-weight:600;color:var(--text-mid,#888);padding:0 4px">Ombrellone <strong>${codice}</strong></div>
    <button id="mappa-popup-rinomina" style="text-align:left;padding:6px 10px;border:1px solid var(--border,#ddd);border-radius:6px;background:#fff;cursor:pointer;font-size:13px">✏️ Rinomina</button>
    <button id="mappa-popup-elimina" style="text-align:left;padding:6px 10px;border:1px solid var(--border,#ddd);border-radius:6px;background:#fff;cursor:pointer;font-size:13px;color:var(--red,#c0392b)">🗑️ Elimina</button>
  `;
  document.body.appendChild(popup);

  const closePopup = (e) => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', closePopup); } };
  setTimeout(() => document.addEventListener('mousedown', closePopup), 0);

  popup.querySelector('#mappa-popup-rinomina').addEventListener('click', () => {
    popup.remove();
    document.removeEventListener('mousedown', closePopup);
    const nuovo = prompt(`Rinomina ombrellone "${codice}":`, codice);
    if (nuovo !== null && nuovo.trim() !== '') {
      mappaState.codici[`${r}_${c}`] = nuovo.trim();
      updateCell(r, c);
    }
  });

  popup.querySelector('#mappa-popup-elimina').addEventListener('click', async () => {
    popup.remove();
    document.removeEventListener('mousedown', closePopup);
    const ombId = mappaState.ids[`${r}_${c}`];
    if (ombId) {
      const ok = await _confermaRimozioneOmbrellone(ombId, codice);
      if (!ok) return;
      if (!mappaState.toDelete) mappaState.toDelete = [];
      mappaState.toDelete.push(ombId);
      delete mappaState.ids[`${r}_${c}`];
    }
    setCellTipo(r, c, CELL_TIPO.VUOTO);
  });
}

async function _confermaRimozioneOmbrellone(ombId, codice) {
  const [{ data: clienti }, { data: prenot }] = await Promise.all([
    sb.from('clienti_stagionali').select('id,nome,cognome').eq('ombrellone_id', ombId).limit(1),
    sb.from('disponibilita').select('id').eq('ombrellone_id', ombId).limit(1)
  ]);
  const hasCliente = clienti && clienti.length > 0;
  const hasPrenot = prenot && prenot.length > 0;

  let msg = `Vuoi rimuovere l'ombrellone "${codice}" dalla mappa?`;
  if (hasCliente) {
    const c = clienti[0];
    msg += `\n\n⚠️ Ha un cliente associato: ${c.nome || ''} ${c.cognome || ''}. L'anagrafica verrà eliminata.`;
  }
  if (hasPrenot) {
    msg += `\n\n⚠️ Ha prenotazioni/disponibilità collegate che verranno rimosse.`;
  }
  return confirm(msg);
}

async function _onClickSalvaMappa() {
  if (_mappaModalita === 'create') {
    await salvaMappaStabilimento(_mappaStabilimentoId);
    return;
  }

  const errors = validateCodici();
  if (errors.length) { showMappaError(errors.join(' · ')); return; }

  const ombsDaEliminare = mappaState.toDelete || [];
  const ombsDaSpostare = [];

  if (_mappaOriginalSnapshot) {
    for (const orig of _mappaOriginalSnapshot.ombs) {
      const nuovaPosKey = Object.keys(mappaState.ids).find(k => mappaState.ids[k] === orig.id);
      if (nuovaPosKey) {
        const [nr, nc] = nuovaPosKey.split('_').map(Number);
        if (nr !== orig.pos_y || nc !== orig.pos_x) {
          ombsDaSpostare.push({ id: orig.id, codice: orig.codice, pos_x: nc, pos_y: nr });
        }
      }
    }
  }

  const nuovi = [];
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE && !mappaState.ids[`${r}_${c}`]) {
        nuovi.push({ r, c, codice: mappaState.codici[`${r}_${c}`] || '' });
      }
    }
  }

  const parti = [];
  if (ombsDaEliminare.length) parti.push(`• ${ombsDaEliminare.length} ombrelloni eliminati (con eventuali clienti e prenotazioni collegate)`);
  if (ombsDaSpostare.length) parti.push(`• ${ombsDaSpostare.length} ombrelloni spostati`);
  if (nuovi.length) parti.push(`• ${nuovi.length} nuovi ombrelloni aggiunti`);

  if (parti.length === 0) {
    await _salvaMappaMod();
    return;
  }

  const msg = `Stai per salvare le seguenti modifiche alla mappa:\n\n${parti.join('\n')}\n\nConfermi?`;
  if (!confirm(msg)) return;

  await _salvaMappaMod();
}

async function _salvaMappaMod() {
  const btn = _qid('btn-mappa-salva');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  showMappaError('');

  const stabId = _mappaStabilimentoId;

  const ombsDaEliminare = mappaState.toDelete || [];
  for (const id of ombsDaEliminare) {
    await sb.from('disponibilita').delete().eq('ombrellone_id', id);
    await sb.from('clienti_stagionali').delete().eq('ombrellone_id', id);
    await sb.from('ombrelloni').delete().eq('id', id);
  }

  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      const id = mappaState.ids[`${r}_${c}`];
      if (id) {
        const inputEl = _qid(`codice-input-${r}-${c}`);
        const codice = inputEl ? inputEl.value.trim() : (mappaState.codici[`${r}_${c}`] || '');
        await sb.from('ombrelloni').update({ pos_x: c, pos_y: r, codice }).eq('id', id);
      }
    }
  }

  const nuovi = [];
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE && !mappaState.ids[`${r}_${c}`]) {
        const inputEl = _qid(`codice-input-${r}-${c}`);
        const codice = inputEl ? inputEl.value.trim() : (mappaState.codici[`${r}_${c}`] || '');
        nuovi.push({ stabilimento_id: stabId, codice, pos_x: c, pos_y: r, credito_giornaliero: 1.00 });
      }
    }
  }
  if (nuovi.length) await sb.from('ombrelloni').insert(nuovi);

  const passerelle = [];
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.PASSERELLA) passerelle.push({ x: c, y: r });
    }
  }
  await sb.from('stabilimenti').update({ mappa_passerelle: passerelle }).eq('id', stabId);
  if (currentStabilimento) currentStabilimento.mappa_passerelle = passerelle;

  chiudiMappaBuilderOverlay();
  await loadManagerData();
}

window.apriMappaBuilderOverlay = apriMappaBuilderOverlay;
window.chiudiMappaBuilderOverlay = chiudiMappaBuilderOverlay;
window._onClickSalvaMappa = _onClickSalvaMappa;
