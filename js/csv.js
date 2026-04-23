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
