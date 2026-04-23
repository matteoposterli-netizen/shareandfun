function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows
    .map(r => r.map(f => f.trim()))
    .filter(r => r.some(f => f !== ''));
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function isHeaderRow(row, numericColIdx) {
  const v = row[numericColIdx];
  if (v == null || v === '') return true;
  return !/^\d+$/.test(v);
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

async function readCSVFile(file, numericColIdx) {
  const text = await file.text();
  let rows = parseCSV(text);
  if (rows.length && isHeaderRow(rows[0], numericColIdx)) rows = rows.slice(1);
  return rows;
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

function downloadCSVTemplate(filename, content) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function scaricaCSVOmbrelloniTemplate() {
  downloadCSVTemplate('esempio-ombrelloni.csv',
    'fila,numero,credito_giornaliero\nA,1,12.00\nA,2,12.00\nB,1,10.00\n');
}

function scaricaCSVClientiTemplate() {
  downloadCSVTemplate('esempio-clienti.csv',
    'fila,numero_ombrellone,nome,cognome,telefono,email\nA,1,Mario,Rossi,3331234567,mario@example.com\nB,5,Anna,Bianchi,,anna@example.com\n');
}
