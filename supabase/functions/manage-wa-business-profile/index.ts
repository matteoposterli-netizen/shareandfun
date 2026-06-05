// Edge Function: manage-wa-business-profile
// Legge e aggiorna il profilo business WhatsApp via Twilio Senders API v2
// (https://messaging.twilio.com/v2/Channels/Senders).
//
// Modes (query param ?mode=...):
//   - list:    elenca tutti i senders disponibili (debug)
//   - get:     trova il sender WA per +393520426199 e ritorna il profilo attuale (default)
//   - update:  aggiorna i campi del profilo (solo admin matteo.posterli@gmail.com)
//
// Body per mode=update (POST):
//   {
//     "profile": {
//       "about":       "...",
//       "address":     "...",
//       "description": "...",
//       "emails":      ["..."],
//       "websites":    ["https://spiaggiamia.com"],
//       "vertical":    "TRAVEL",   // enum Twilio
//       "logo_url":    "https://spiaggiamia.com/assets/wa-profile-picture.jpg"
//     }
//   }
//
// verify_jwt=true: l'utente deve essere autenticato Supabase per chiamare.
// La mode=update ha un check aggiuntivo lato server: email caller deve combaciare
// con ADMIN_EMAIL.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const WA_SENDER_NUMBER = "+393520426199";
const ADMIN_EMAIL = "matteo.posterli@gmail.com";

// Twilio Senders API v2 richiede il parametro Channel quando si listano i sender.
const SENDERS_LIST_URL =
  "https://messaging.twilio.com/v2/Channels/Senders?PageSize=100&Channel=whatsapp";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getCallerEmail(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await supa.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.email ?? null;
}

async function listSenders(twilioAuth: string) {
  const r = await fetch(SENDERS_LIST_URL, {
    headers: { Authorization: `Basic ${twilioAuth}` },
  });
  const raw = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { ok: r.ok, status: r.status, data };
}

async function findWhatsAppSender(twilioAuth: string) {
  const { ok, status, data } = await listSenders(twilioAuth);
  if (!ok) throw new Error(`Twilio list senders: HTTP ${status} ${JSON.stringify(data)}`);
  const senders = (data && data.senders) || [];
  const target = senders.find((s: any) => {
    const id = String(s.sender_id || "");
    return id === `whatsapp:${WA_SENDER_NUMBER}` || id.endsWith(WA_SENDER_NUMBER);
  });
  return {
    sid: target ? target.sid : null,
    raw: target || null,
    all_senders_summary: senders.map((s: any) => ({ sid: s.sid, sender_id: s.sender_id, status: s.status })),
  };
}

async function getSender(sid: string, twilioAuth: string) {
  const r = await fetch(`https://messaging.twilio.com/v2/Channels/Senders/${sid}`, {
    headers: { Authorization: `Basic ${twilioAuth}` },
  });
  const raw = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  if (!r.ok) throw new Error(`Twilio get sender ${sid}: HTTP ${r.status} ${JSON.stringify(data)}`);
  return data;
}

async function updateSenderProfile(
  sid: string,
  profile: Record<string, unknown>,
  twilioAuth: string,
) {
  const body = { profile };
  const r = await fetch(`https://messaging.twilio.com/v2/Channels/Senders/${sid}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${twilioAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { ok: r.ok, status: r.status, response: data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return jsonResp({ error: "Missing Twilio credentials in Supabase secrets" }, 500);
  }

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "get";
    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    if (mode === "list") {
      const result = await listSenders(twilioAuth);
      return jsonResp({ mode, ...result, fetched_at: new Date().toISOString() });
    }

    if (mode === "get") {
      const { sid, raw, all_senders_summary } = await findWhatsAppSender(twilioAuth);
      if (!sid) {
        return jsonResp(
          {
            mode,
            error: `Nessun sender WhatsApp trovato per ${WA_SENDER_NUMBER}`,
            all_senders_summary,
          },
          404,
        );
      }
      const detail = await getSender(sid, twilioAuth);
      return jsonResp({
        mode,
        sender_sid: sid,
        sender_id: raw?.sender_id,
        status: detail.status,
        offline_reason_code: detail.offline_reason_code ?? null,
        webhook: detail.webhook ?? null,
        profile: detail.profile ?? null,
        configuration: detail.configuration ?? null,
        fetched_at: new Date().toISOString(),
      });
    }

    if (mode === "update") {
      // Admin-only
      const email = await getCallerEmail(req);
      if (email !== ADMIN_EMAIL) {
        return jsonResp(
          { error: `Forbidden: solo admin (${ADMIN_EMAIL}) puo' aggiornare il profilo. Caller: ${email ?? "anonymous"}` },
          403,
        );
      }
      const body = await req.json().catch(() => ({}));
      const profile = (body && body.profile) || {};
      if (!profile || typeof profile !== "object" || Object.keys(profile).length === 0) {
        return jsonResp(
          { error: "Body deve contenere { profile: { ... } } con almeno un campo" },
          400,
        );
      }
      const { sid } = await findWhatsAppSender(twilioAuth);
      if (!sid) {
        return jsonResp({ error: `Sender ${WA_SENDER_NUMBER} non trovato` }, 404);
      }
      const result = await updateSenderProfile(sid, profile, twilioAuth);
      return jsonResp({
        mode,
        sender_sid: sid,
        profile_submitted: profile,
        ...result,
        fetched_at: new Date().toISOString(),
      });
    }

    return jsonResp({ error: "Invalid mode. Use ?mode=list|get|update" }, 400);
  } catch (e) {
    return jsonResp({ error: String((e as any)?.message || e) }, 500);
  }
});
