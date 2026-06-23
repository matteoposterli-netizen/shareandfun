function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }
function showLoading() { document.getElementById('loading-overlay').style.display = 'flex'; }

// PostgREST su Supabase hosted ritorna al massimo 1000 righe per query: oltre
// quella soglia il payload viene troncato silenziosamente. Le viste che leggono
// `disponibilita` per tutti gli ombrelloni in un range stagionale sforano
// facilmente (49 ombrelloni × 183 giorni ≈ 9k righe). Helper che pagina via
// `.range()` finché non riceve una pagina parziale. `buildQuery` è una factory
// perché un PostgrestFilterBuilder non si può riassegnare dopo `.range()`.
async function fetchAllPaginated(buildQuery, pageSize = 1000) {
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return { data: all, error: null };
}

// Normalize <input type="date"> UX across browsers via flatpickr (Safari <14.1
// shipped without a native date picker; even modern Safari diverges from
// Chrome/Edge/Firefox). Keeps the underlying value as ISO "YYYY-MM-DD" so
// existing onchange handlers that read .value keep working.
function enhanceDateInputs(root) {
  if (typeof flatpickr === 'undefined') return;
  const scope = root || document;
  const inputs = scope.querySelectorAll('input[type="date"]:not([data-fp-enhanced])');
  inputs.forEach(input => {
    input.setAttribute('data-fp-enhanced', '1');
    flatpickr(input, {
      locale: (flatpickr.l10ns && flatpickr.l10ns.it) || 'default',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      allowInput: true,
      disableMobile: true,
    });
  });
}

// On flatpickr-enhanced date inputs the original is hidden and a visible alt
// input tracks the picker; setting .value directly leaves the alt out of sync.
function setDateInputValue(input, value) {
  if (!input) return;
  if (input._flatpickr) {
    input._flatpickr.setDate(value, false);
    return;
  }
  if (value instanceof Date) input.value = toLocalDateStr(value);
  else input.value = value || '';
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function togglePasswordVisibility(btn) {
  const wrap = btn.closest('.password-wrap');
  if (!wrap) return;
  const input = wrap.querySelector('input');
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.classList.toggle('is-visible', !showing);
  btn.setAttribute('aria-label', showing ? 'Mostra password' : 'Nascondi password');
  btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
}

function showAlert(containerId, msg, type) {
  if (!containerId) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  if (type === 'success') setTimeout(() => { el.innerHTML = ''; }, 5000);
}

function coinName(stab) {
  const s = stab || (typeof currentStabilimento !== 'undefined' ? currentStabilimento : null);
  return (s?.nome_credito || 'Crediti');
}

function formatCoin(amount, stab) {
  return `${parseFloat(amount || 0).toFixed(2)} ${coinName(stab)}`;
}

function refreshCoinLabels(stab) {
  const unit = coinName(stab);
  document.querySelectorAll('[data-coin-label]').forEach(el => {
    const base = el.dataset.coinLabel;
    el.textContent = `${base} (${unit})`;
  });
}

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayStr() {
  return toLocalDateStr(new Date());
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Normalizza un numero di telefono in formato internazionale E.164 (+39…),
// usato per le notifiche WhatsApp/SMS. Default Italia.
function normalizzaTelefonoIT(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) return s;
  if (s.startsWith('3')) return '+39' + s; // cellulare IT
  if (s.startsWith('0')) return '+39' + s; // fisso IT
  return '+' + s;
}

function formatDateShort(str) {
  if (!str) return '';
  const d = new Date(str);
  const today = new Date();
  // Confronta i giorni nel fuso italiano, così "Oggi"/"Ieri" e l'ora mostrata
  // sono coerenti con l'orario locale dello stabilimento, indipendentemente dal
  // fuso del browser.
  const dayKey = (x) => x.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
  const yest = new Date(today.getTime() - 86400000);
  if (dayKey(d) === dayKey(today)) {
    return 'Oggi ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
  }
  if (dayKey(d) === dayKey(yest)) return 'Ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' });
}

function substitutePlaceholders(text, data) {
  if (!text) return text;
  return text
    .replace(/\{\{\s*nome\s*\}\}/gi, data?.nome || '')
    .replace(/\{\{\s*cognome\s*\}\}/gi, data?.cognome || '')
    .replace(/\{\{\s*ombrellone\s*\}\}/gi, data?.ombrellone || '')
    .replace(/\{\{\s*importo\s*\}\}/gi, data?.importo_formatted || '')
    .replace(/\{\{\s*saldo\s*\}\}/gi, data?.saldo_formatted || '')
    .replace(/\{\{\s*stabilimento\s*\}\}/gi, data?.stabilimento_nome || '')
    .replace(/\{\{\s*nota\s*\}\}/gi, data?.nota || '')
    .replace(/\{\{\s*gg_disponibilita\s*\}\}/gi, String(data?.gg_disponibilita ?? ''))
    .replace(/\{\{\s*gg_subaffittato\s*\}\}/gi, String(data?.gg_subaffittato ?? ''))
    .replace(/\{\{\s*coin_ricevuti\s*\}\}/gi, data?.coin_ricevuti_formatted || '')
    .replace(/\{\{\s*coin_spesi\s*\}\}/gi, data?.coin_spesi_formatted || '');
}

async function inviaEmail(tipo, clienteData, stab, override) {
  try {
    let oggetto_custom = null, testo_custom = null;
    if (override && (override.oggetto || override.testo)) {
      oggetto_custom = override.oggetto || null;
      testo_custom = override.testo || null;
    } else if (tipo === 'benvenuto') {
      oggetto_custom = stab?.email_benvenuto_oggetto || null;
      testo_custom = stab?.email_benvenuto_testo || null;
    } else if (tipo === 'invito') {
      oggetto_custom = stab?.email_invito_oggetto || null;
      testo_custom = stab?.email_invito_testo || null;
    } else if (tipo === 'credito_accreditato') {
      oggetto_custom = stab?.email_credito_accreditato_oggetto || null;
      testo_custom = stab?.email_credito_accreditato_testo || null;
    } else if (tipo === 'credito_ritirato') {
      oggetto_custom = stab?.email_credito_ritirato_oggetto || null;
      testo_custom = stab?.email_credito_ritirato_testo || null;
    } else if (tipo === 'credito_revocato') {
      oggetto_custom = stab?.email_credito_revocato_oggetto || null;
      testo_custom = stab?.email_credito_revocato_testo || null;
    } else if (tipo === 'chiusura_stagione') {
      oggetto_custom = stab?.email_chiusura_stagione_oggetto || null;
      testo_custom = stab?.email_chiusura_stagione_testo || null;
    }
    const placeholderData = { ...clienteData, stabilimento_nome: stab?.nome || '' };
    oggetto_custom = substitutePlaceholders(oggetto_custom, placeholderData);
    testo_custom = substitutePlaceholders(testo_custom, placeholderData);

    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) {
      // Senza session non possiamo autenticarci verso invia-email (verify_jwt=true).
      // Per coerenza con il pattern post-T9 della saga 5 giu 2026, usiamo
      // comunque sb.functions.invoke() che gestisce l'auth automaticamente.
      // Se session manca, sb cade sulla chiave del client (sb_publishable_*)
      // che NON e' JWT e verra' rifiutata dal gateway con 401 — comportamento
      // corretto (no auth = no invio email).
      console.warn(`Email ${tipo}: nessuna session, salto`);
      return false;
    }
    // BUGFIX 5 giu 2026 / lezione Tentativo 9: sb.functions.invoke gestisce
    // automaticamente l'Authorization header con la session corrente, evitando
    // dimenticanze e allineando il codice al pattern usato in doForgotPassword.
    const { data, error: invokeErr } = await sb.functions.invoke('invia-email', {
      body: {
        tipo,
        email: clienteData.email,
        nome: clienteData.nome,
        cognome: clienteData.cognome || '',
        ombrellone: clienteData.ombrellone || null,
        invite_link: clienteData.invite_link || null,
        login_link: clienteData.login_link || null,
        importo_formatted: clienteData.importo_formatted || null,
        saldo_formatted: clienteData.saldo_formatted || null,
        nota: clienteData.nota || null,
        gg_disponibilita: clienteData.gg_disponibilita ?? null,
        gg_subaffittato: clienteData.gg_subaffittato ?? null,
        coin_ricevuti_formatted: clienteData.coin_ricevuti_formatted || null,
        coin_spesi_formatted: clienteData.coin_spesi_formatted || null,
        stabilimento_id: stab?.id || null,
        stabilimento_nome: stab?.nome || '',
        stabilimento_telefono: stab?.telefono || '',
        stabilimento_email: stab?.email || '',
        oggetto_custom,
        testo_custom,
      },
    });
    if (invokeErr) { console.error(`Email ${tipo} fallita:`, invokeErr); return false; }
    if (data?.warning) console.warn(`Email ${tipo}:`, data.warning);
    else console.log(`Email ${tipo} inviata:`, data);
    return true;
  } catch (e) {
    console.error(`Email ${tipo} eccezione:`, e);
    return false;
  }
}

// Formatta un array di date ordinate in italiano: "il 5 luglio" / "dal 5 al 7 luglio".
function formatPeriodo(dates) {
  if (!dates || !dates.length) return '';
  const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
                'luglio','agosto','settembre','ottobre','novembre','dicembre'];
  if (dates.length === 1) {
    const d = new Date(dates[0] + 'T00:00:00');
    return `il ${d.getDate()} ${MESI[d.getMonth()]}`;
  }
  const first = new Date(dates[0] + 'T00:00:00');
  const last  = new Date(dates[dates.length - 1] + 'T00:00:00');
  const mF = MESI[first.getMonth()], mL = MESI[last.getMonth()];
  return mF === mL
    ? `dal ${first.getDate()} al ${last.getDate()} ${mL}`
    : `dal ${first.getDate()} ${mF} al ${last.getDate()} ${mL}`;
}

// Formatta un importo con segno esplicito davanti (per il campo {{3}} del
// template WA spiaggiamia_operazione_warm). Esempi:
//   formatCoinSigned(20, '+', stab) → "+20.00 Crediti"
//   formatCoinSigned(15, '-', stab) → "-15.00 Crediti"
function formatCoinSigned(amount, sign, stab) {
  return `${sign}${formatCoin(amount, stab)}`;
}

// Data di oggi in formato breve "dd/mm/yyyy" (per i campi {{2}} periodo
// delle notifiche WA su operazioni puntuali: utilizzo credito, rettifica).
function todayDDMMYYYY() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// Invia una notifica WhatsApp via Edge Function invia-whatsapp.
// Ritorna sempre un oggetto { ok: boolean, skipped?: string, error?: string }
// per permettere ai chiamanti di sapere se l'invio e' andato a buon fine.
// Retrocompatibile con i chiamanti "fire-and-forget" che ignorano il return.
// Parametri per tipo:
//   invito              → params: { cliente_id, token }
//   benvenuto           → params: { cliente_id }
//   variazione_credito  → params: { cliente_id, periodo, variazione, saldo_nuovo }
//                          (template generico spiaggiamia_operazione_warm,
//                           usato per sub-affitto / annullamento / utilizzo /
//                           rettifica — `variazione` deve avere segno esplicito
//                           +/- davanti, es. "+20.00 Crediti" o "-15.00 Crediti")
//   recupero_password   → params: { cliente_id, link }
async function inviaWhatsapp(tipo, params, stab) {
  try {
    if (!stab?.wa_enabled) return { ok: false, skipped: 'wa_disabled' };
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) {
      // Coerente con il pattern post-T9: senza session non possiamo
      // autenticarci verso invia-whatsapp. La function ha verify_jwt=false
      // (post-T12) ma il suo guard 401 interno richiede comunque service-role
      // OR user-JWT valido. Senza session il client cadrebbe sulla chiave
      // sb_publishable_* che non passa il guard (non e' SERVICE_KEY e
      // getUser fallisce) -> 401 silenzioso. Ritorniamo subito per chiarezza.
      console.warn(`WA ${tipo}: nessuna session, salto`);
      return { ok: false, skipped: 'no_session' };
    }
    // BUGFIX 5 giu 2026 / lezione Tentativo 9: sb.functions.invoke gestisce
    // automaticamente l'Authorization header con la session corrente.
    const body = { tipo, stabilimento_id: stab.id, ...params };
    const { data, error: invokeErr } = await sb.functions.invoke('invia-whatsapp', { body });
    if (invokeErr) {
      console.error(`WA ${tipo} fallito:`, invokeErr);
      return { ok: false, error: invokeErr?.message || 'invoke_error' };
    }
    if (data?.skipped) {
      console.log(`WA ${tipo} saltato:`, data.skipped);
      return { ok: false, skipped: data.skipped };
    }
    console.log(`WA ${tipo} inviato`);
    return { ok: true };
  } catch (e) {
    console.error(`WA ${tipo} eccezione:`, e);
    return { ok: false, error: e?.message || 'exception' };
  }
}

// Invia una notifica push (FCM) al proprietario via Edge Function invia-push.
// Canale parallelo a WhatsApp/email. Fire-and-forget: non deve bloccare la UI.
// Stesso pattern di inviaWhatsapp: sb.functions.invoke gestisce l'Authorization
// con la session corrente; la function ha verify_jwt=false + guard interna.
async function inviaPush(params) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) {
      console.warn('push: nessuna session, salto');
      return { ok: false, skipped: 'no_session' };
    }
    const { data, error: invokeErr } = await sb.functions.invoke('invia-push', { body: params });
    if (invokeErr) {
      console.error('push fallita:', invokeErr);
      return { ok: false, error: invokeErr?.message || 'invoke_error' };
    }
    if (data?.skipped) {
      console.log('push saltata:', data.skipped);
      return { ok: false, skipped: data.skipped };
    }
    console.log('push inviata:', data?.sent ?? '?');
    return { ok: true };
  } catch (e) {
    console.error('push eccezione:', e);
    return { ok: false, error: e?.message || 'exception' };
  }
}

// Distingue un input utente come email o telefono.
// Regola semplice e robusta: contiene '@' -> email; altrimenti tel.
// Casi di whitespace/empty: considerati non-email (l'eventuale
// normalizzazione telefono ritornera' stringa vuota e il login
// fallira' con "Credenziali errate", coerente con UX desiderata).
function isEmailLike(s) {
  return typeof s === 'string' && s.includes('@');
}

// Costruisce un'email sintetica deterministica a partire da un
// telefono in formato E.164. Usata in fase di completamento invito
// quando il cliente non ha un'email reale: diventa l'identificatore
// tecnico su auth.users. NON e' un'email inviabile, e' solo un alias.
// Esempio: "+393201234567" -> "393201234567@phone.spiaggiamia.it"
function emailSinteticaDaTelefono(telE164) {
  if (!telE164) return null;
  // Rimuove il "+" iniziale ed eventuali caratteri non-digit residui
  const digits = String(telE164).replace(/^\+/, '').replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@phone.spiaggiamia.it`;
}

// Chiama l'Edge Function richiedi-reset-cliente per inviare un reset
// password manager-driven a un cliente registrato.
// Ritorna { ok, sent_via?, skipped?, error? }.
// NOTA: questo helper mantiene il pattern fetch raw (vs sb.functions.invoke)
// perche' ha gia' il guard `no_session` esplicito che ritorna early. Il
// pattern e' equivalente nella sostanza al sb.functions.invoke usato in
// inviaEmail/inviaWhatsapp (entrambi richiedono session valida per
// procedere). Lasciato come e' per minimizzare il diff post-saga 5 giu 2026.
async function richiediResetCliente(clienteId, canale) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, error: 'no_session' };
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/richiedi-reset-cliente`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ cliente_id: clienteId, canale }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`richiedi-reset-cliente fallito (${canale}):`, data);
      return { ok: false, error: data?.error || res.statusText };
    }
    if (data?.skipped) {
      console.log(`richiedi-reset-cliente saltato (${canale}):`, data.skipped);
      return { ok: false, skipped: data.skipped };
    }
    console.log(`richiedi-reset-cliente OK (${data.sent_via})`);
    return { ok: true, sent_via: data.sent_via };
  } catch (e) {
    console.error(`richiedi-reset-cliente eccezione:`, e);
    return { ok: false, error: e?.message || 'exception' };
  }
}
