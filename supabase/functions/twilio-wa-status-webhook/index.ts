// Edge Function: twilio-wa-status-webhook
// Riceve i webhook di Twilio quando lo status di un messaggio WhatsApp
// cambia (queued → sent → delivered o → failed/undelivered).
// Verifica la firma Twilio (X-Twilio-Signature) per sicurezza, poi
// aggiorna la riga corrispondente in wa_messages_log.
//
// Configurazione Supabase: verify_jwt = false (Twilio chiama senza JWT).
// La sicurezza e' garantita dalla verifica HMAC-SHA1 della firma con
// TWILIO_AUTH_TOKEN.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// L'URL pubblico ESATTO con cui Twilio ci chiama. Necessario per la
// verifica firma: Twilio firma <URL+params concatenati>, e l'URL deve
// matchare bit-per-bit. Costruiamo da SUPABASE_URL invece di leggerlo
// da req.url (req.url in Edge Functions a volte arriva come URL interno
// http:// post-proxy, mentre Twilio firma l'URL pubblico https://).
const PUBLIC_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/twilio-wa-status-webhook`;

async function computeTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
): Promise<string> {
  // Twilio algoritmo: URL + (key+value per ogni param, ordinato alfabeticamente)
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(authToken);
  const dataBytes = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, dataBytes);
  // Base64-encode the binary signature
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

Deno.serve(async (req) => {
  // Health check / debugging via GET
  if (req.method === "GET") {
    return new Response("twilio-wa-status-webhook alive", { status: 200 });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Twilio invia form-urlencoded
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    console.error("Failed to parse form data", e);
    return new Response("Bad request", { status: 400 });
  }

  const params: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    params[k] = typeof v === "string" ? v : String(v);
  }

  // Verifica firma Twilio. In caso di mismatch loggo ma per ora NON rifiuto
  // (modalita' diagnostica per il primo deploy: vediamo nei logs se la
  // verifica funziona bene prima di rendere il check bloccante).
  // TODO post-test: cambiare il "log only" in "return 401" sotto.
  const receivedSig = req.headers.get("X-Twilio-Signature") ?? "";
  const expectedSig = await computeTwilioSignature(
    PUBLIC_WEBHOOK_URL,
    params,
    TWILIO_AUTH_TOKEN,
  );
  const sigValid = receivedSig === expectedSig;
  if (!sigValid) {
    console.warn("Twilio signature mismatch", {
      received: receivedSig,
      expected: expectedSig,
      url: PUBLIC_WEBHOOK_URL,
      paramKeys: Object.keys(params).sort(),
    });
    // Per ora continuiamo, in futuro: return new Response("Invalid signature", { status: 401 });
  }

  // Estrai i campi rilevanti
  const messageSid = params["MessageSid"];
  const messageStatus = params["MessageStatus"];
  const errorCode = params["ErrorCode"] ? parseInt(params["ErrorCode"], 10) : null;
  const errorMessage = params["ErrorMessage"] || null;

  if (!messageSid || !messageStatus) {
    console.warn("Missing required Twilio params", { messageSid, messageStatus });
    // Twilio invia anche per altri eventi (es. delivery receipt da WhatsApp),
    // potrebbero non avere MessageStatus. Rispondiamo 200 per non far retry.
    return new Response("OK (no-op)", { status: 200 });
  }

  // Aggiorna la riga in wa_messages_log
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error: upErr } = await admin
    .from("wa_messages_log")
    .update({
      status: messageStatus,
      error_code: errorCode,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("twilio_sid", messageSid)
    .select();

  if (upErr) {
    console.error("DB update failed", upErr);
    return new Response("DB error", { status: 500 });
  }

  if (!data || data.length === 0) {
    // Possibile: il webhook arriva PRIMA che invia-whatsapp abbia salvato
    // la riga (race condition rara, network latencies). Rispondiamo 200,
    // Twilio fara' altri retry per i prossimi cambi di stato.
    console.warn("Webhook for unknown twilio_sid (race condition?)", messageSid);
    return new Response("OK (no row)", { status: 200 });
  }

  console.log(
    `WA status: ${messageSid} -> ${messageStatus}${
      errorCode ? ` [err ${errorCode}: ${errorMessage}]` : ""
    }`,
  );
  return new Response("OK", { status: 200 });
});
