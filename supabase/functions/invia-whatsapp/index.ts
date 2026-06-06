import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Credenziali Twilio — impostare come segreti nella Supabase Dashboard:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   TWILIO_WA_FROM       → es. "whatsapp:+391234567890"
//   WA_SID_INVITO        → Content SID HX... del template invito
//                          (spiaggiamia_invito_stagionale — vars 1,2,3=token)
//   WA_SID_BENVENUTO     → Content SID HX... del template benvenuto
//                          (spiaggiamia_registrazione_medium dal 6 giu 2026,
//                           vars 1=nome, 2=stabilimento, 3=loginIdentifier per
//                           button "Accedi alla tua area" → ?login={{3}})
//   WA_SID_SUBAFFITTO    → Content SID HX... del template spiaggiamia_operazione_warm.
//                          Nome env legacy: il template è generico, usato per
//                          QUALSIASI variazione di credito (tipo "variazione_credito"):
//                          sub-affitto, annullamento, utilizzo, rettifica.
//                          Vars: 1=nome, 2=periodo (descrittivo), 3=variazione
//                          con segno esplicito (es. "+20.00 Crediti"), 4=saldo,
//                          5=stabilimento, 6=loginIdentifier per button
//                          "Accedi alla tua area" → ?login={{6}}.
//   WA_SID_RECUPERO      → Content SID HX... del template recupero password
//                          (spiaggiamia_recupero_password_v3, vars 1=stabilimento,
//                           2=nome, 3=stabilimento, 4=query string completa).
//                          Finché non è valorizzata, il tipo recupero_password
//                          risponde graceful con
//                          { skipped: "template_recupero_non_configurato" }.
//
// Delivery tracking (da v25, 06 giu 2026):
//   Ogni POST a Twilio include `StatusCallback` → twilio-wa-status-webhook.
//   Dopo invio riuscito, INSERT in wa_messages_log con status='queued'.
//   Il webhook aggiornera' la riga con sent/delivered/failed/undelivered.
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")  ?? "";
const TWILIO_WA_FROM     = Deno.env.get("TWILIO_WA_FROM")     ?? "";
const WA_SID_INVITO      = Deno.env.get("WA_SID_INVITO")      ?? "";
const WA_SID_BENVENUTO   = Deno.env.get("WA_SID_BENVENUTO")   ?? "";
const WA_SID_SUBAFFITTO  = Deno.env.get("WA_SID_SUBAFFITTO")  ?? "";
const WA_SID_RECUPERO    = Deno.env.get("WA_SID_RECUPERO")    ?? "";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")            ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

interface WaRequest {
  tipo: "invito" | "benvenuto" | "variazione_credito" | "recupero_password";
  stabilimento_id: string;
  cliente_id: string;
  // invito
  token?: string;
  // variazione_credito
  periodo?: string;
  variazione?: string;
  saldo_nuovo?: string;
  // recupero_password
  link?: string;
}

// Normalizza un numero di telefono italiano al formato E.164 (+39XXXXXXXXXX).
// Se non riesce, restituisce null.
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let n = raw.replace(/\s+/g, "").replace(/[-.()/]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (!n.startsWith("+")) {
    n = n.startsWith("39") ? "+" + n : "+39" + n;
  }
  return /^\+\d{7,15}$/.test(n) ? n : null;
}

// Invia un messaggio WhatsApp via Twilio Programmable Messaging (Content Templates).
// Ritorna anche il MessageSid (twilio_sid) per il delivery tracking via webhook.
async function twilioSend(to: string, contentSid: string, contentVariables: Record<string, string>): Promise<{ ok: boolean; error?: string; twilio_sid?: string; twilio_status?: number; twilio_body?: any }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WA_FROM) {
    return { ok: false, error: "Twilio credentials non configurate" };
  }
  if (!contentSid) {
    return { ok: false, error: "Content SID non configurato" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  // StatusCallback: Twilio chiama questo URL ad ogni cambio di stato del
  // messaggio (queued → sent → delivered o → failed/undelivered). Il
  // webhook aggiorna la riga corrispondente in wa_messages_log, cosi'
  // l'app sa se il messaggio e' davvero stato consegnato.
  const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/twilio-wa-status-webhook`;

  const body = new URLSearchParams({
    From: TWILIO_WA_FROM,
    To: `whatsapp:${to}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(contentVariables),
    StatusCallback: statusCallbackUrl,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Twilio ${res.status}: ${txt.slice(0, 200)}` };
  }
  // Parse response per estrarre il MessageSid (twilio_sid) restituito.
  // Serve per linkare il webhook callback successivo alla riga in
  // wa_messages_log.
  const respData = await res.json().catch(() => ({}));
  return { ok: true, twilio_sid: respData.sid, twilio_status: res.status, twilio_body: respData };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  let payload: WaRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON non valido" }, 400);
  }

  const { tipo, stabilimento_id, cliente_id, token, periodo, variazione, saldo_nuovo, link } = payload;

  if (!tipo || !stabilimento_id || !cliente_id) {
    return jsonResponse({ error: "Parametri mancanti" }, 400);
  }

  // Verifica JWT: accetta sia service-role key (chiamate server-to-server)
  // sia user-JWT (chiamate manager-driven). verify_jwt=false al gateway
  // (vedi WHATSAPP_INTEGRAZIONE.md Tentativo 12 per il razionale).
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const anonClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let callerUserId: string | null = null;
  const isServiceRole = !!jwt && jwt === SUPABASE_SERVICE_KEY;
  if (jwt && !isServiceRole) {
    const { data: ud, error: authErr } = await anonClient.auth.getUser(jwt);
    if (authErr || !ud?.user) {
      return jsonResponse({ error: "Non autorizzato" }, 401);
    }
    callerUserId = ud.user.id;
  }

  if (!isServiceRole && !callerUserId) {
    return jsonResponse({ error: "Autenticazione richiesta (service-role o user JWT valido)" }, 401);
  }

  const { data: stab, error: stabErr } = await anonClient
    .from("stabilimenti")
    .select("id, nome, wa_enabled, proprietario_id")
    .eq("id", stabilimento_id)
    .single();

  if (stabErr || !stab) {
    return jsonResponse({ error: "Stabilimento non trovato" }, 404);
  }

  if (tipo === "recupero_password" && !isServiceRole) {
    if (!callerUserId || stab.proprietario_id !== callerUserId) {
      return jsonResponse({ error: "Non sei il proprietario di questo stabilimento" }, 403);
    }
  }

  if (!stab.wa_enabled) {
    return jsonResponse({ ok: false, skipped: "wa_disabled" }, 200);
  }

  const { data: cliente, error: cliErr } = await anonClient
    .from("clienti_stagionali")
    .select("id, nome, cognome, email, telefono, whatsapp_consenso")
    .eq("id", cliente_id)
    .single();

  if (cliErr || !cliente) {
    return jsonResponse({ error: "Cliente non trovato" }, 404);
  }

  if (tipo !== "recupero_password" && !cliente.whatsapp_consenso) {
    return jsonResponse({ ok: false, skipped: "no_consenso" }, 200);
  }

  const phone = normalizePhone(cliente.telefono);
  if (!phone) {
    return jsonResponse({ ok: false, skipped: "telefono_non_valido" }, 200);
  }

  const nome = cliente.nome || "";
  const stabilimentoNome = stab.nome || "";

  // Identificativo per il button "Accedi alla tua area" dei template
  // spiaggiamia_registrazione_medium (var {{3}}) e spiaggiamia_operazione_warm
  // (var {{6}}). Fallback: email se presente, altrimenti telefono normalizzato.
  // URL-encode sempre, perche' Twilio Content Templates non fanno auto-encoding.
  const loginIdentifier = encodeURIComponent(
    (cliente.email && cliente.email.trim()) || phone || ""
  );

  let contentSid: string;
  let contentVariables: Record<string, string>;

  if (tipo === "invito") {
    if (!token) return jsonResponse({ error: "token mancante" }, 400);
    contentSid = WA_SID_INVITO;
    contentVariables = {
      "1": nome,
      "2": stabilimentoNome,
      "3": token,
    };
  } else if (tipo === "benvenuto") {
    contentSid = WA_SID_BENVENUTO;
    contentVariables = {
      "1": nome,
      "2": stabilimentoNome,
      "3": loginIdentifier,
    };
  } else if (tipo === "variazione_credito") {
    if (!periodo || !variazione || !saldo_nuovo) {
      return jsonResponse({ error: "Parametri variazione_credito mancanti (periodo, variazione, saldo_nuovo)" }, 400);
    }
    // Template spiaggiamia_operazione_warm (HX… in WA_SID_SUBAFFITTO).
    // Generico per qualsiasi movimento di saldo: la stringa {{3}} contiene
    // segno esplicito (+/-), {{2}} descrive il contesto (sub-affitto,
    // annullamento, utilizzo credito, rettifica).
    contentSid = WA_SID_SUBAFFITTO;
    contentVariables = {
      "1": nome,
      "2": periodo,
      "3": variazione,
      "4": saldo_nuovo,
      "5": stabilimentoNome,
      "6": loginIdentifier,
    };
  } else if (tipo === "recupero_password") {
    if (!link) return jsonResponse({ error: "link mancante" }, 400);
    if (!WA_SID_RECUPERO) {
      return jsonResponse({ ok: false, skipped: "template_recupero_non_configurato" }, 200);
    }
    contentSid = WA_SID_RECUPERO;
    contentVariables = {
      "1": stabilimentoNome,
      "2": nome,
      "3": stabilimentoNome,
      "4": link,
    };
  } else {
    return jsonResponse({ error: "tipo non valido" }, 400);
  }

  const result = await twilioSend(phone, contentSid, contentVariables);

  // Se l'invio Twilio e' andato a buon fine, logga la riga in
  // wa_messages_log. Il webhook twilio-wa-status-webhook aggiornera'
  // poi la riga con gli status successivi (sent, delivered, failed...).
  if (result.ok && result.twilio_sid) {
    const { error: insErr } = await anonClient
      .from("wa_messages_log")
      .insert({
        twilio_sid: result.twilio_sid,
        stabilimento_id: stab.id,
        cliente_id: cliente.id,
        tipo,
        to_number: phone,
        status: "queued",
      });
    if (insErr) {
      // Non bloccante: l'invio e' gia' partito, il log e' best-effort.
      console.error("wa_messages_log insert failed", insErr);
    }
  }

  console.log(`WA ${tipo} -> ${phone}: ${JSON.stringify({ ok: result.ok, sid: result.twilio_sid, error: result.error })}`);
  // Sanitize response al chiamante: non esponiamo il twilio_body completo
  // (best practice di sicurezza), solo ok / sid / error.
  return jsonResponse({
    ok: result.ok,
    twilio_sid: result.twilio_sid,
    error: result.error,
  }, 200);
});
