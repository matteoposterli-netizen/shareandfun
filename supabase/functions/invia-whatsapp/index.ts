import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Credenziali Twilio — impostare come segreti nella Supabase Dashboard:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   TWILIO_WA_FROM       → es. "whatsapp:+391234567890"
//   WA_SID_INVITO        → Content SID HX... del template invito (esistente)
//   WA_SID_BENVENUTO     → Content SID HX... del template benvenuto (esistente)
//   WA_SID_SUBAFFITTO    → Content SID HX... del template sub-affitto confermato (esistente)
//   WA_SID_RECUPERO      → Content SID HX... del template recupero password
//                          (NUOVA — da impostare quando Meta approva il template
//                           "recupero_password" su Twilio. Finché non è valorizzata,
//                           il tipo recupero_password risponde graceful con
//                           { skipped: "template_recupero_non_configurato" }.)
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")  ?? "";
const TWILIO_WA_FROM     = Deno.env.get("TWILIO_WA_FROM")     ?? "";
const WA_SID_INVITO      = Deno.env.get("WA_SID_INVITO")      ?? "";
const WA_SID_BENVENUTO   = Deno.env.get("WA_SID_BENVENUTO")   ?? "";
const WA_SID_SUBAFFITTO  = Deno.env.get("WA_SID_SUBAFFITTO")  ?? "";
const WA_SID_RECUPERO    = Deno.env.get("WA_SID_RECUPERO")    ?? "";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")            ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface WaRequest {
  tipo: "invito" | "benvenuto" | "subaffitto_confermato" | "recupero_password";
  stabilimento_id: string;
  cliente_id: string;
  // invito
  token?: string;
  // subaffitto_confermato
  periodo?: string;
  coin_guadagnati?: string;
  coin_totali?: string;
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
    // Prefisso italiano di default se non c'è prefisso internazionale
    n = n.startsWith("39") ? "+" + n : "+39" + n;
  }
  // Valida: + seguito da 7-15 cifre
  return /^\+\d{7,15}$/.test(n) ? n : null;
}

// Invia un messaggio WhatsApp via Twilio Programmable Messaging (Content Templates).
async function twilioSend(to: string, contentSid: string, contentVariables: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WA_FROM) {
    return { ok: false, error: "Twilio credentials non configurate" };
  }
  if (!contentSid) {
    return { ok: false, error: "Content SID non configurato" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  const body = new URLSearchParams({
    From: TWILIO_WA_FROM,
    To: `whatsapp:${to}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(contentVariables),
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
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }

  let payload: WaRequest;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON non valido" }), { status: 400 });
  }

  const { tipo, stabilimento_id, cliente_id, token, periodo, coin_guadagnati, coin_totali, link } = payload;

  if (!tipo || !stabilimento_id || !cliente_id) {
    return new Response(JSON.stringify({ error: "Parametri mancanti" }), { status: 400 });
  }

  // Verifica JWT (la funzione richiede un utente autenticato o service role).
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const anonClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (jwt) {
    // Chiamata server-to-server (es. dalla Edge Function recupero-password):
    // la service role key è già una credenziale fidata e non rappresenta un
    // utente, quindi auth.getUser() fallirebbe. La accettiamo direttamente.
    if (jwt !== SUPABASE_SERVICE_KEY) {
      const { error: authErr } = await anonClient.auth.getUser(jwt);
      if (authErr) {
        return new Response(JSON.stringify({ error: "Non autorizzato" }), { status: 401 });
      }
    }
  }

  // Carica lo stabilimento (wa_enabled + nome) con service role.
  const { data: stab, error: stabErr } = await anonClient
    .from("stabilimenti")
    .select("id, nome, wa_enabled")
    .eq("id", stabilimento_id)
    .single();

  if (stabErr || !stab) {
    return new Response(JSON.stringify({ error: "Stabilimento non trovato" }), { status: 404 });
  }

  if (!stab.wa_enabled) {
    return new Response(JSON.stringify({ ok: false, skipped: "wa_disabled" }), { status: 200 });
  }

  // Carica il cliente (telefono + consenso + nome).
  const { data: cliente, error: cliErr } = await anonClient
    .from("clienti_stagionali")
    .select("id, nome, cognome, telefono, whatsapp_consenso")
    .eq("id", cliente_id)
    .single();

  if (cliErr || !cliente) {
    return new Response(JSON.stringify({ error: "Cliente non trovato" }), { status: 404 });
  }

  // Il recupero password è una comunicazione di servizio richiesta esplicitamente
  // dall'utente: non rientra nei consensi marketing, quindi bypassa il controllo.
  if (tipo !== "recupero_password" && !cliente.whatsapp_consenso) {
    return new Response(JSON.stringify({ ok: false, skipped: "no_consenso" }), { status: 200 });
  }

  const phone = normalizePhone(cliente.telefono);
  if (!phone) {
    return new Response(JSON.stringify({ ok: false, skipped: "telefono_non_valido" }), { status: 200 });
  }

  const nome = cliente.nome || "";
  const stabilimentoNome = stab.nome || "";

  let contentSid: string;
  let contentVariables: Record<string, string>;

  if (tipo === "invito") {
    if (!token) return new Response(JSON.stringify({ error: "token mancante" }), { status: 400 });
    contentSid = WA_SID_INVITO;
    contentVariables = {
      "1": nome,
      "2": stabilimentoNome,
      // Variabile del bottone URL (numerazione indipendente nel template Twilio).
      // Se l'invio fallisce, verificare se Twilio richiede chiave diversa (es. "3").
      "button_1_url_0": token,
    };
  } else if (tipo === "benvenuto") {
    contentSid = WA_SID_BENVENUTO;
    contentVariables = {
      "1": nome,
      "2": stabilimentoNome,
    };
  } else if (tipo === "subaffitto_confermato") {
    if (!periodo || !coin_guadagnati || !coin_totali) {
      return new Response(JSON.stringify({ error: "Parametri sub-affitto mancanti" }), { status: 400 });
    }
    contentSid = WA_SID_SUBAFFITTO;
    contentVariables = {
      "1": nome,
      "2": periodo,
      "3": coin_guadagnati,
      "4": coin_totali,
      "5": stabilimentoNome,
    };
  } else if (tipo === "recupero_password") {
    if (!link) return new Response(JSON.stringify({ error: "link mancante" }), { status: 400 });
    // Template Meta non ancora approvato: graceful skip senza errore.
    if (!WA_SID_RECUPERO) {
      return new Response(JSON.stringify({ ok: false, skipped: "template_recupero_non_configurato" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    contentSid = WA_SID_RECUPERO;
    contentVariables = {
      "1": stabilimentoNome, // header
      "2": nome,
      "3": stabilimentoNome, // body
      "4": link,             // recovery URL
    };
  } else {
    return new Response(JSON.stringify({ error: "tipo non valido" }), { status: 400 });
  }

  const result = await twilioSend(phone, contentSid, contentVariables);

  console.log(`WA ${tipo} → ${phone}: ${JSON.stringify(result)}`);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
