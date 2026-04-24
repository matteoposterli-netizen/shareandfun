function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function runWithConcurrency(items, limit, fn, onProgress) {
  const total = items.length;
  let cursor = 0, done = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      try { await fn(items[idx], idx); } catch (e) { console.error(e); }
      done++;
      if (onProgress) onProgress(done, total);
    }
  }
  const n = Math.min(limit, total) || 0;
  await Promise.all(Array.from({ length: n }, worker));
}

async function retryUntilTrue(fn, attempts = 3, baseDelay = 500) {
  for (let i = 0; i < attempts; i++) {
    try { if (await fn()) return true; } catch (e) { console.error(e); }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
  }
  return false;
}

function renderProgressInAlert(alertId, label, done, total) {
  const el = document.getElementById(alertId);
  if (!el) return;
  const pct = total ? Math.round(done * 100 / total) : 100;
  el.innerHTML = `
    <div class="alert alert-success">
      ${label} ${done} / ${total}
      <div style="margin-top:6px;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--ocean);transition:width .2s"></div>
      </div>
    </div>`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const XLSX_HEADERS = ['fila', 'numero', 'credito_giornaliero', 'nome', 'cognome', 'telefono', 'email'];

function slugifyForFilename(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'stabilimento';
}

function buildXlsxAndDownload(rows, filename) {
  const aoa = [XLSX_HEADERS, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ombrelloni');
  XLSX.writeFile(wb, filename);
}

function scaricaExcelSampleTemplate() {
  const sampleRows = [
    ['A', 1, 12.00, 'Mario',  'Rossi',   '3331234567', 'mario@example.com'],
    ['A', 2, 12.00, 'Anna',   'Bianchi', '',           'anna@example.com'],
    ['B', 1, 10.00, '',       '',        '',           ''],
  ];
  buildXlsxAndDownload(sampleRows, 'spiaggiamia-template.xlsx');
}

async function scaricaExcel() {
  const ombs = (typeof ombrelloniList !== 'undefined' && ombrelloniList) ? ombrelloniList : [];
  if (!ombs.length) { scaricaExcelSampleTemplate(); return; }

  const clienti = (typeof clientiList !== 'undefined' && clientiList) ? clientiList : [];
  const orphans = clienti.filter(c => !c.ombrellone_id);
  if (orphans.length) {
    const elenco = orphans.slice(0, 5).map(c => `• ${c.nome || ''} ${c.cognome || ''} — ${c.email || '(senza email)'}`.trim()).join('\n');
    const more = orphans.length > 5 ? `\n…e altri ${orphans.length - 5}` : '';
    const ok = confirm(
      `Trovati ${orphans.length} clienti senza ombrellone assegnato.\n\n${elenco}${more}\n\n` +
      `La policy attuale richiede che ogni cliente sia assegnato a un ombrellone. ` +
      `Vuoi eliminarli prima di scaricare l'Excel?\n\nOK = elimina e scarica · Annulla = interrompi`
    );
    if (!ok) return;
    const ids = orphans.map(c => c.id);
    const { error } = await sb.from('clienti_stagionali').delete().in('id', ids);
    if (error) { alert(`Errore eliminazione clienti orfani: ${error.message}`); return; }
    if (typeof loadManagerData === 'function') await loadManagerData();
  }

  const ombsSorted = [...((typeof ombrelloniList !== 'undefined' && ombrelloniList) || [])]
    .sort((a, b) => (a.fila || '').localeCompare(b.fila || '') || (a.numero - b.numero));
  const clienteByOmb = {};
  ((typeof clientiList !== 'undefined' && clientiList) || []).forEach(c => { if (c.ombrellone_id) clienteByOmb[c.ombrellone_id] = c; });

  const rows = ombsSorted.map(o => {
    const c = clienteByOmb[o.id];
    return [
      o.fila || '',
      o.numero,
      parseFloat(o.credito_giornaliero || 0),
      c?.nome || '',
      c?.cognome || '',
      c?.telefono || '',
      c?.email || '',
    ];
  });

  const stab = (typeof currentStabilimento !== 'undefined' && currentStabilimento) || {};
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const filename = `spiaggiamia-${slugifyForFilename(stab.nome)}-${dateStr}.xlsx`;
  buildXlsxAndDownload(rows, filename);
}

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
}

async function readExcelFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const wsName = wb.SheetNames[0];
  if (!wsName) return [];
  const ws = wb.Sheets[wsName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
  if (!raw.length) return [];
  const headerRow = raw[0].map(normalizeHeader);
  const colIdx = {};
  XLSX_HEADERS.forEach(k => { colIdx[k] = headerRow.indexOf(k); });
  if (colIdx.fila === -1 || colIdx.numero === -1) return [];
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const fila = String(r[colIdx.fila] ?? '').trim().toUpperCase();
    const numero = parseInt(r[colIdx.numero], 10);
    if (!fila || !numero) continue;
    const creditoRaw = colIdx.credito_giornaliero >= 0 ? r[colIdx.credito_giornaliero] : '';
    const credito = parseFloat(String(creditoRaw).replace(',', '.'));
    rows.push({
      fila,
      numero,
      credito: isNaN(credito) ? 10 : credito,
      nome:     String(colIdx.nome     >= 0 ? r[colIdx.nome]     : '').trim(),
      cognome:  String(colIdx.cognome  >= 0 ? r[colIdx.cognome]  : '').trim(),
      telefono: String(colIdx.telefono >= 0 ? r[colIdx.telefono] : '').trim(),
      email:    String(colIdx.email    >= 0 ? r[colIdx.email]    : '').trim(),
    });
  }
  return rows;
}
