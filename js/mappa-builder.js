// ===== MAPPA BUILDER =====
// Visual builder for beach umbrella layout during onboarding

const MAPPA_COLS = 20;
const MAPPA_ROWS = 20;
const CELL_TIPO = { OMBRELLONE: 'ombrellone', PASSERELLA: 'passerella', VUOTO: 'vuoto' };

let mappaState = {
  grid: [],
  codici: {},
  modalita: CELL_TIPO.OMBRELLONE,
  step: 1,
  selectedCell: null
};

let _mappaStabilimentoId = null;

function initGrid() {
  mappaState.grid = Array.from({ length: MAPPA_ROWS }, () =>
    Array(MAPPA_COLS).fill(CELL_TIPO.VUOTO)
  );
  mappaState.codici = {};
  mappaState.selectedCell = null;
  mappaState.step = 1;
}

function getOmbrelloniCount() {
  return mappaState.grid.flat().filter(t => t === CELL_TIPO.OMBRELLONE).length;
}

function setModalita(tipo) {
  mappaState.modalita = tipo;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const btnId = tipo === CELL_TIPO.OMBRELLONE ? 'btn-mode-ombrellone'
              : tipo === CELL_TIPO.PASSERELLA ? 'btn-mode-passerella'
              : 'btn-mode-vuoto';
  document.getElementById(btnId)?.classList.add('active');
}

function updateCell(r, c) {
  const el = document.querySelector(`[data-r="${r}"][data-c="${c}"]`);
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
  const counter = document.getElementById('mappa-counter');
  if (counter) counter.textContent = `${n} ombrelloni`;
  const btn = document.getElementById('btn-mappa-avanti');
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

// Aggiunge le label BAR (top) e MARE (bottom) intorno a un elemento griglia
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

function renderMappaStep1() {
  const grid = document.getElementById('mappa-grid-step1');
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
        _mappaDragging = true;
        setCellTipo(r, c, mappaState.modalita);
        e.preventDefault();
      });
      cell.addEventListener('mouseenter', () => {
        if (_mappaDragging) setCellTipo(r, c, mappaState.modalita);
      });
      grid.appendChild(cell);
    }
  }
  grid.addEventListener('mouseup', () => { _mappaDragging = false; });
  document.addEventListener('mouseup', () => { _mappaDragging = false; }, { once: false });
  updateCounter();
  _addBarMareLabels(grid);
}

function renderMappaStep2() {
  const gridEl = document.getElementById('mappa-grid-step2');
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

  const table = document.getElementById('mappa-codici-table');
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
        input.placeholder = `es. ${String.fromCharCode(65 + Math.floor(idx / 10))}${idx % 10 || 10}`;
        input.value = mappaState.codici[`${r}_${c}`] || '';
        input.addEventListener('input', () => {
          mappaState.codici[`${r}_${c}`] = input.value;
          const cellEl = document.querySelector(`#mappa-grid-step2 [data-r="${r}"][data-c="${c}"]`);
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
}

function selectCellStep2(r, c) {
  mappaState.selectedCell = { r, c };
  document.querySelectorAll('#mappa-grid-step2 .mappa-cell').forEach(el => el.classList.remove('selected'));
  const cellEl = document.querySelector(`#mappa-grid-step2 [data-r="${r}"][data-c="${c}"]`);
  if (cellEl) cellEl.classList.add('selected');
  document.querySelectorAll('.codice-row').forEach(el => el.classList.remove('selected-row'));
  const rowEl = document.getElementById(`codice-row-${r}-${c}`);
  if (rowEl) rowEl.classList.add('selected-row');
  const input = document.getElementById(`codice-input-${r}-${c}`);
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function goToStep2() {
  if (getOmbrelloniCount() === 0) return;
  mappaState.step = 2;
  document.getElementById('mappa-step1-content').style.display = 'none';
  document.getElementById('mappa-step2-content').style.display = '';
  document.getElementById('mappa-step-1-label').classList.remove('active');
  document.getElementById('mappa-step-2-label').classList.add('active');
  renderMappaStep2();
}

function goToStep1() {
  mappaState.step = 1;
  document.getElementById('mappa-step2-content').style.display = 'none';
  document.getElementById('mappa-step1-content').style.display = '';
  document.getElementById('mappa-step-1-label').classList.add('active');
  document.getElementById('mappa-step-2-label').classList.remove('active');
  renderMappaStep1();
}

function showMappaError(msg) {
  const el = document.getElementById('mappa-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

function validateCodici() {
  const ombrelloni = [];
  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE) {
        ombrelloni.push({ r, c, codice: (mappaState.codici[`${r}_${c}`] || '').trim() });
      }
    }
  }
  const errors = [];
  const vuoti = ombrelloni.filter(o => !o.codice);
  if (vuoti.length) errors.push(`${vuoti.length} ombrelloni senza nome`);
  const codiciList = ombrelloni.map(o => o.codice).filter(Boolean);
  const duplicati = codiciList.filter((v, i) => codiciList.indexOf(v) !== i);
  if (duplicati.length) errors.push(`Nomi duplicati: ${[...new Set(duplicati)].join(', ')}`);
  return errors;
}

async function salvaMappaStabilimento(stabilimentoId) {
  const errors = validateCodici();
  if (errors.length) { showMappaError(errors.join(' · ')); return; }

  const btn = document.getElementById('btn-mappa-salva');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }

  const ombrelloniData = [];
  const passerelleData = [];

  for (let r = 0; r < MAPPA_ROWS; r++) {
    for (let c = 0; c < MAPPA_COLS; c++) {
      if (mappaState.grid[r][c] === CELL_TIPO.OMBRELLONE) {
        ombrelloniData.push({
          stabilimento_id: stabilimentoId,
          codice: mappaState.codici[`${r}_${c}`].trim(),
          pos_x: c,
          pos_y: r,
          credito_giornaliero: 10.00
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

  chiudiMappaBuilder();
  await loadManagerData();
  showView('manager');
}

function mostraMappaBuilder(stabilimentoId) {
  _mappaStabilimentoId = stabilimentoId;
  // Rimuovi active da tutti i view + rimuovi inline display:none che prevale sul CSS
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
// OVERRIDE renderManagerMap — layout griglia pos_x/pos_y
// Caricato dopo manager.js, sovrascrive la funzione flat-list.
// ============================================================
function renderManagerMap(ombs, dispMap) {
  const el = document.getElementById('manager-map');
  el.innerHTML = '';
  if (!ombs.length) return;

  // Verifica se ci sono posizioni significative (non tutti a 0,0)
  const uniquePos = new Set(ombs.map(o => `${o.pos_x || 0}_${o.pos_y || 0}`));
  const hasGrid = uniquePos.size > 1 || ombs.length === 1;

  const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

  const buildOmbrelloneCell = (o) => {
    const stato = dispMap[o.id] || 'occupied';
    const cell = document.createElement('div');
    const cls = stato === 'libero' ? 'free'
      : stato === 'combinazione' ? 'combo'
      : stato === 'parziale' ? 'partial'
      : stato === 'sub_affittato' ? 'subleased'
      : 'occupied';
    const isSelected = bookingSelection.has(o.id);
    const hasCliente = (clientiList || []).some(c => !c.rifiutato && c.ombrellone_id === o.id);
    const noClienteCls = !hasCliente ? ' no-cliente' : '';
    cell.className = 'ombrellone ' + cls + noClienteCls + (isSelected ? ' selected' : '');
    cell.textContent = '☂️';
    let hint = '';
    const freeDays = (currentMapRange?.dates || []).filter(d => (currentMapRange?.dispByOmbDate?.[o.id] || {})[d] === 'libero');
    const selectSuffix = isSelected
      ? ' — selezionato, clicca per rimuoverlo dalla prenotazione'
      : ' — clicca per aggiungerlo alla prenotazione';
    if (stato === 'libero') {
      hint = ' — libero per tutto il periodo' + selectSuffix;
    } else if (stato === 'combinazione') {
      const covers = (currentMapRange?.combinationCovers || {})[o.id] || [];
      const days = covers.map(fmtDay).join(', ');
      const extra = freeDays.filter(d => !covers.includes(d));
      const extraTxt = extra.length ? ` (libero anche ${extra.map(fmtDay).join(', ')})` : '';
      hint = ` — copre ${covers.length} giorn${covers.length === 1 ? 'o' : 'i'}: ${days}${extraTxt}` + selectSuffix;
    } else if (stato === 'parziale') {
      const days = freeDays.map(fmtDay).join(', ');
      hint = ` — libero ${freeDays.length} giorn${freeDays.length === 1 ? 'o' : 'i'}: ${days}` + selectSuffix;
    } else if (stato === 'sub_affittato') {
      hint = ' — sub-affittato';
    }
    cell.title = `${o.codice} — ${formatCoin(o.credito_giornaliero)}/gg${hint}`;
    cell.onclick = () => toggleMapOmbSelection(o, stato);
    return cell;
  };

  if (hasGrid) {
    // Layout griglia usando pos_x/pos_y
    const byPos = {};
    ombs.forEach(o => { byPos[`${o.pos_x || 0}_${o.pos_y || 0}`] = o; });
    const passerelle = new Set((currentStabilimento?.mappa_passerelle || []).map(p => `${p.x}_${p.y}`));
    const maxX = Math.max(...ombs.map(o => o.pos_x || 0));
    const maxY = Math.max(...ombs.map(o => o.pos_y || 0));

    // Label BAR (top = y=0 = lato bar)
    const barDiv = document.createElement('div');
    barDiv.className = 'bar-label';
    barDiv.textContent = 'BAR';
    el.appendChild(barDiv);

    const mapRows = document.createElement('div');
    mapRows.className = 'map-rows';

    for (let y = 0; y <= maxY; y++) {
      const row = document.createElement('div');
      row.className = 'map-row';
      for (let x = 0; x <= maxX; x++) {
        const key = `${x}_${y}`;
        const o = byPos[key];
        if (o) {
          row.appendChild(buildOmbrelloneCell(o));
        } else if (passerelle.has(key)) {
          const cell = document.createElement('div');
          cell.className = 'map-passerella';
          row.appendChild(cell);
        } else {
          const cell = document.createElement('div');
          cell.className = 'map-empty';
          row.appendChild(cell);
        }
      }
      mapRows.appendChild(row);
    }
    el.appendChild(mapRows);

    // Label MARE (bottom = y=maxY = lato mare)
    const mareDiv = document.createElement('div');
    mareDiv.className = 'sea-label';
    mareDiv.textContent = 'MARE';
    el.appendChild(mareDiv);

  } else {
    // Fallback: lista flat per ombrelloni aggiunti manualmente senza layout
    const sorted = ombs.slice().sort((a, b) => (a.codice || '').localeCompare(b.codice || '', 'it', { numeric: true }));
    const mapRows = document.createElement('div');
    mapRows.className = 'map-rows';
    const row = document.createElement('div');
    row.className = 'map-row';
    sorted.forEach(o => row.appendChild(buildOmbrelloneCell(o)));
    mapRows.appendChild(row);
    el.appendChild(mapRows);
  }
}
