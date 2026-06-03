// Edge Function: richiedi-reset-cliente
// Endpoint manager-driven per inviare un reset password a un cliente.
// Diverso da recupero-password (self-service generic): qui il manager
// loggato sceglie esplicitamente cliente e canale, e riceve una
// risposta DETTAGLIATA (no generic { ok: true } anti-enumeration:
// l'autenticazione e il check ownership ci proteggono gia').
//
// Input: { cliente_id: uuid, canale: 'email' | 'whatsapp' }
// Output:
//   { ok: true, sent_via: 'email' | 'whatsapp' }            success
//   { ok: false, skipped: '...' }                            soft-fail
//   { error: '...' }                                         hard-fail
//
// Skip conditions:
//   email_sintetica   -> email auth termina in @phone.spiaggiamia.it
//   wa_disabled       -> wa_enabled = false sullo stabilimento
//   telefono_assente  -> cliente.telefono mancante
//   no_consenso       -> cliente.whatsapp_consenso = false

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://spiaggiamia.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

interface ReqBody {
  cliente_id: string;
  canale: 'email' | 'whatsapp';
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let payload: ReqBody;
  try { payload = await req.json(); }
  catch { return jsonResponse({ error: "JSON non valido" }, 400); }

  const { cliente_id, canale } = payload;
  if (!cliente_id || !canale) return jsonResponse({ error: "Parametri mancanti: cliente_id, canale" }, 400);
  if (canale !== 'email' && canale !== 'whatsapp') {
    return jsonResponse({ error: "Canale non valido (email|whatsapp)" }, 400);
  }

  // Verifica JWT del manager
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!jwt) return jsonResponse({ error: "Non autorizzato" }, 401);
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: userData, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !userData?.user) return jsonResponse({ error: "Non autorizzato" }, 401);
  const managerId = userData.user.id;

  // Recupera cliente + verifica registrato
  const { data: cliente, error: cliErr } = await admin
    .from('clienti_stagionali')
    .select('id, nome, cognome, telefono, whatsapp_consenso, user_id, stabilimento_id')
    .eq('id', cliente_id)
    .single();
  if (cliErr || !cliente) return jsonResponse({ error: "Cliente non trovato" }, 404);
  if (!cliente.user_id) return jsonResponse({ error: "Cliente non ancora registrato" }, 400);

  // Recupera stabilimento + verifica ownership
  const { data: stab, error: stabErr } = await admin
    .from('stabilimenti')
    .select('id, nome, proprietario_id, wa_enabled, telefono, email')
    .eq('id', cliente.stabilimento_id)
    .single();
  if (stabErr || !stab) return jsonResponse({ error: "Stabilimento non trovato" }, 404);
  if (stab.proprietario_id !== managerId) {
    return jsonResponse({ error: "Non sei il proprietario di questo stabilimento" }, 403);
  }

  // Recupera email auth (vera o sintetica)
  const { data: targetUser, error: getUserErr } = await admin.auth.admin.getUserById(cliente.user_id);
  if (getUserErr || !targetUser?.user?.email) {
    console.error("getUserById error", getUserErr);
    return jsonResponse({ error: "Utente auth non trovato" }, 404);
  }
  const authEmail = targetUser.user.email;
  const isSyntheticEmail = authEmail.endsWith('@phone.spiaggiamia.it');

  // Pre-check skip conditions
  if (canale === 'email' && isSyntheticEmail) {
    return jsonResponse({ ok: false, skipped: 'email_sintetica' });
  }
  if (canale === 'whatsapp') {
    if (!stab.wa_enabled) return jsonResponse({ ok: false, skipped: 'wa_disabled' });
    if (!cliente.telefono) return jsonResponse({ ok: false, skipped: 'telefono_assente' });
    if (!cliente.whatsapp_consenso) return jsonResponse({ ok: false, skipped: 'no_consenso' });
  }

  // Genera recovery link via Admin API
  const redirectTo = `${APP_URL}/?reset=1`;
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: authEmail,
    options: { redirectTo },
  });
  if (linkErr || !linkData?.properties?.action_link) {
    console.error("generateLink error", linkErr);
    return jsonResponse({ error: "Link recovery non generato" }, 500);
  }
  const recoveryLink = linkData.properties.action_link;

  // Audit log della richiesta (fire-and-forget, attribuito al manager via JWT)
  fetch(`${SUPABASE_URL}/rest/v1/rpc/audit_log_write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      p_stabilimento_id: stab.id,
      p_entity_type: "cliente_stagionale",
      p_action: "reset_password_richiesto",
      p_description: `Reset password richiesto per ${cliente.nome || ''} ${cliente.cognome || ''} via ${canale}`,
      p_metadata: { cliente_id, canale },
    }),
  }).catch(e => console.warn("audit log reset_password_richiesto failed", e));

  // Invio sul canale richiesto: usa SEMPRE il JWT del manager originale
  // (non SERVICE_KEY) per la chiamata server-to-server, perche' la
  // SUPABASE_SERVICE_ROLE_KEY env var non e' disponibile/valida nella
  // function (passa un bearer vuoto al gateway -> 401). Le due function
  // chiamate (invia-email e invia-whatsapp) sono state aggiornate per
  // accettare jwt manager + ownership check.
  if (canale === 'email') {
    const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/invia-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tipo: 'reset_password',
        email: authEmail,
        nome: cliente.nome || '',
        cognome: cliente.cognome || '',
        stabilimento_id: stab.id,
        stabilimento_nome: stab.nome,
        stabilimento_telefono: stab.telefono || '',
        stabilimento_email: stab.email || '',
        recovery_link: recoveryLink,
      }),
    });
    const data = await emailRes.json().catch(() => ({}));
    if (!emailRes.ok) {
      console.error("invia-email reset_password failed", data);
      return jsonResponse({ error: `Email failed: ${data?.error || emailRes.status}` }, 500);
    }
    return jsonResponse({ ok: true, sent_via: 'email' });
  }

  // canale === 'whatsapp' (riusa tipo recupero_password gia' esistente)
  // Estrae la sola query string del recovery link per il template WhatsApp:
  // Meta richiede che il button URL del template abbia prefisso statico +
  // variabile come suffisso/parametro, non l'URL intero come variabile pura.
  // Il template Twilio ha URL fisso
  //   https://btnyzzpibedkslhtiizu.supabase.co/auth/v1/verify?{{4}}
  // e {{4}} viene popolato con la sola query string del recovery link:
  //   token=...&type=recovery&redirect_to=...
  // L'URL ricomposto al runtime resta esattamente l'action_link Supabase
  // originale, quindi il flusso di verify+redirect funziona come prima.
  const recoveryUrl = new URL(recoveryLink);
  const recoveryQuery = recoveryUrl.search.slice(1); // rimuove il '?' iniziale

  const waRes = await fetch(`${SUPABASE_URL}/functions/v1/invia-whatsapp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tipo: 'recupero_password',
      stabilimento_id: stab.id,
      cliente_id: cliente.id,
      link: recoveryQuery, // solo la query string (Meta requirement template URL)
    }),
  });
  const waData = await waRes.json().catch(() => ({}));
  if (!waRes.ok) {
    console.error("invia-whatsapp recupero_password failed", waData);
    return jsonResponse({ error: `WA failed: ${waData?.error || waRes.status}` }, 500);
  }
  if (waData.skipped) return jsonResponse({ ok: false, skipped: waData.skipped });
  return jsonResponse({ ok: true, sent_via: 'whatsapp' });
});
