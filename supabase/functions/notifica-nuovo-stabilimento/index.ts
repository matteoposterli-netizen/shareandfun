// Edge Function: notifica-nuovo-stabilimento
// Notifica gli admin di piattaforma quando un proprietario registra un nuovo
// stabilimento (che nasce "in attesa" di approvazione). Chiamata in
// fire-and-forget da js/setup.js subito dopo l'insert.
//
// verify_jwt=true (config.toml): la function e' sempre invocata da un utente
// con sessione valida (il proprietario appena registrato), stesso ragionamento
// gia' usato per invia-email. Accetta anche la SERVICE_ROLE_KEY per eventuali
// chiamate server-to-server.
//
// Input: { stabilimento_nome, citta, proprietario_nome, proprietario_cognome,
//          proprietario_email }
//
// Fa DUE cose indipendenti (una NON blocca l'altra): 1) email a Matteo via
// Resend, 2) messaggio Telegram via HTTPS diretto. Se un canale fallisce (o
// non e' configurato) logga l'errore e prosegue con l'altro; l'esito non viene
// mai propagato al chiamante come errore (la registrazione non deve rompersi).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "SpiaggiaMia <noreply@spiaggiamia.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "";

// Destinatario email admin e link diretto alla dashboard (fissi di piattaforma).
const ADMIN_EMAIL = "matteo.posterli@gmail.com";
const ADMIN_URL = "https://spiaggiamia.com/admin.html";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ReqBody {
  stabilimento_nome?: string;
  citta?: string;
  proprietario_nome?: string;
  proprietario_cognome?: string;
  proprietario_email?: string;
}

async function inviaEmailAdmin(b: ReqBody): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY non configurata — email admin saltata");
    return;
  }
  const stab = b.stabilimento_nome || "(senza nome)";
  const citta = b.citta || "—";
  const propNome = `${b.proprietario_nome || ""} ${b.proprietario_cognome || ""}`.trim() || "—";
  const propEmail = b.proprietario_email || "—";

  const subject = `🆕 Nuova richiesta stabilimento: ${stab}`;
  const html = `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#f0f9ff;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #bae6fd">
      <tr><td style="background:linear-gradient(90deg,#0369a1,#0ea5e9);padding:24px 28px">
        <div style="color:#fff;font-size:20px;font-weight:bold">🆕 Nuova richiesta stabilimento</div>
        <div style="color:#bae6fd;font-size:13px;margin-top:4px">SpiaggiaMia — approvazione richiesta</div>
      </td></tr>
      <tr><td style="padding:24px 28px;color:#1e293b;font-size:14px;line-height:1.7">
        <p style="margin:0 0 16px">Un nuovo stabilimento è stato registrato e attende approvazione:</p>
        <table cellpadding="0" cellspacing="0" style="font-size:14px">
          <tr><td style="color:#64748b;padding:2px 12px 2px 0">Stabilimento:</td><td style="font-weight:bold">${escapeHtml(stab)}</td></tr>
          <tr><td style="color:#64748b;padding:2px 12px 2px 0">Città:</td><td>${escapeHtml(citta)}</td></tr>
          <tr><td style="color:#64748b;padding:2px 12px 2px 0">Proprietario:</td><td>${escapeHtml(propNome)}</td></tr>
          <tr><td style="color:#64748b;padding:2px 12px 2px 0">Email:</td><td>${escapeHtml(propEmail)}</td></tr>
        </table>
        <div style="text-align:center;margin:24px 0 8px">
          <a href="${ADMIN_URL}" style="background:#0369a1;color:#fff;padding:11px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block">Apri la dashboard admin →</a>
        </div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = [
    "🆕 Nuova richiesta stabilimento",
    "",
    `Stabilimento: ${stab}`,
    `Città: ${citta}`,
    `Proprietario: ${propNome}`,
    `Email: ${propEmail}`,
    "",
    `Approva qui: ${ADMIN_URL}`,
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: ADMIN_EMAIL, subject, html, text }),
  });
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`Resend error: ${errTxt}`);
  }
}

async function inviaTelegram(b: ReqBody): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
    // Canale saltato silenziosamente se i secret non sono configurati.
    console.error("TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID mancante — Telegram saltato");
    return;
  }
  const stab = b.stabilimento_nome || "(senza nome)";
  const citta = b.citta || "—";
  const propNome = `${b.proprietario_nome || ""} ${b.proprietario_cognome || ""}`.trim() || "—";
  const propEmail = b.proprietario_email || "—";

  const testo = `🆕 Nuova richiesta stabilimento\n\n${stab} (${citta})\nProprietario: ${propNome} — ${propEmail}\n\nApprova qui: ${ADMIN_URL}`;

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT_ID, text: testo }),
  });
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`Telegram error: ${errTxt}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Verifica JWT: utente autenticato (verify_jwt=true al gateway) oppure
  // chiamata server-to-server con SERVICE_ROLE_KEY. Stesso pattern di
  // invia-email / invia-whatsapp.
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!jwt) {
    return jsonResponse({ error: "Non autorizzato" }, 401);
  }
  if (jwt !== SUPABASE_SERVICE_KEY) {
    const supaClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { error: authErr } = await supaClient.auth.getUser(jwt);
    if (authErr) {
      return jsonResponse({ error: "Non autorizzato" }, 401);
    }
  }

  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body non valido" }, 400);
  }

  // Esegui i due canali in parallelo, ognuno indipendente: un fallimento non
  // impedisce l'altro e non viene mai propagato al chiamante come errore.
  const results = await Promise.allSettled([inviaEmailAdmin(body), inviaTelegram(body)]);
  const email_ok = results[0].status === "fulfilled";
  const telegram_ok = results[1].status === "fulfilled";
  if (!email_ok) console.error("notifica email admin fallita:", (results[0] as PromiseRejectedResult).reason);
  if (!telegram_ok) console.error("notifica Telegram fallita:", (results[1] as PromiseRejectedResult).reason);

  // Rispondi sempre 200: la notifica e' best-effort e non deve mai far
  // fallire la registrazione lato client.
  return jsonResponse({ ok: true, email_ok, telegram_ok }, 200);
});
