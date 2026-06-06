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
//                          Vars: 1=nome, 2=periodo (descrittivo, es.
//                          "Sub-affitto dal 5 al 12 luglio" / "Annullamento
//                          prenotazione …" / "Spesa del 06/06/2026" /
//                          "Rettifica saldo del 06/06/2026"), 3=variazione
//                          con segno esplicito (es. "+20.00 Crediti" /
//                          "-15.50 Crediti"), 4=saldo aggiornato,
//                          5=stabilimento, 6=loginIdentifier per button
//                          "Accedi alla tua area" → ?login={{6}}.
//   WA_SID_RECUPERO      → Content SID HX... del template recupero password
//                          (spiaggiamia_recupero_password_v3, vars 1=stabilimento,
//                           2=nome, 3=stabilimento, 4=query string completa).
//                          Finché non è valorizzata, il tipo recupero_password
//                          risponde graceful con
//                          { skipped: "template_recupero_non_configurato" }.
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")  ?? "";
const TWILIO_WA_FROM     = Deno.env.get("TWILIO_WA_FROM")     ?? "";
const WA_SID_INVITO      = Deno.env.get("WA_SID_INVITO")      ?? "";
const WA_SID_BENVENUTO   = Deno.env.get("WA_SID_BENVENUTO")   ?? "";
const WA_SID_SUBAFFITTO  = Deno.env.get("WA_SID_SUBAFFITTO")  ?? "";
const WA_SID_RECUPERO    = Deno.env.get("WA_SID_RECUPERO")    ?? "";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")            ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Headers CORS uniformi su tutte le response. Allow-Origin: * e' sicuro
// perche' le response non contengono dati sensibili e la function richiede
// autenticazione esplicita nel codice (vedi guard 401 piu' sotto). Senza
// questi headers nelle response POST, browser da origini come
// https://www.spiaggiamia.com bloccano la fetch lato client nonostante il
// server risponda 200 OK.
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
  // sia user-JWT (chiamate manager-driven via richiedi-reset-cliente o UI).
  //
  // BUGFIX 5 giu 2026 / Tentativo 11: la function ha verify_jwt=false al
  // livello di gateway (vedi supabase/config.toml). Necessario perche' la
  // chiamata server-to-server da recupero-password passa
  // `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` e la env var ora
  // contiene una chiave nuovo formato `sb_secret_*` (NON JWT), che il
  // gateway con verify_jwt=true rifiutava con
  // UNAUTHORIZED_INVALID_JWT_FORMAT. Conferma testuale doc Supabase:
  // "The new API keys are not JWTs. Edge Functions only support JWT
  //  verification via the anon and service_role JWT-based API keys."
  //
  // La sicurezza e' ora garantita ESCLUSIVAMENTE dal codice qui sotto:
  // 1. isServiceRole: confronto string equality con SUPABASE_SERVICE_KEY
  //    env var. Funziona con qualsiasi formato (JWT legacy o sb_secret_*)
  //    perche' confronta valori esatti.
  // 2. Per user JWT: validazione via supa.auth.getUser(jwt).
  // 3. Guard 401 obbligatorio: senza service-role NE user JWT valido,
  //    la chiamata e' rifiutata (vedi sotto).
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const anonClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let callerUserId: string | null = null;
  const isServiceRole = !!jwt && jwt === SUPABASE_SERVICE_KEY;
  if (jwt && !isServiceRole) {
    // Chiamata di un utente autenticato: verifica la session via Supabase Auth.
    const { data: ud, error: authErr } = await anonClient.auth.getUser(jwt);
    if (authErr || !ud?.user) {
      return jsonResponse({ error: "Non autorizzato" }, 401);
    }
    callerUserId = ud.user.id;
  }

  // SECURITY GUARD (necessario con verify_jwt=false al gateway):
  // Senza service-role NE user JWT valido, la chiamata e' anonima.
  // Rifiutiamo esplicitamente per evitare che un attaccante possa
  // spammare invii WA verso clienti registrati conoscendo solo gli UUID.
  if (!isServiceRole && !callerUserId) {
    return jsonResponse({ error: "Autenticazione richiesta (service-role o user JWT valido)" }, 401);
  }

  // Carica lo stabilimento (wa_enabled + nome + proprietario per ownership).
  const { data: stab, error: stabErr } = await anonClient
    .from("stabilimenti")
    .select("id, nome, wa_enabled, proprietario_id")
    .eq("id", stabilimento_id)
    .single();

  if (stabErr || !stab) {
    return jsonResponse({ error: "Stabilimento non trovato" }, 404);
  }

  // Sicurezza: il tipo "recupero_password" accetta "link" arbitrario nel
  // payload e bypassa il consenso WA. Per evitare che un utente autenticato
  // qualsiasi possa inviare WA "ufficiali" con URL malevoli ai clienti di
  // altri stabilimenti, accettiamo:
  // - chiamate server-to-server con SERVICE_KEY (es. recupero-password
  //   self-service generic), oppure
  // - chiamate da un manager autenticato che e' proprietario dello
  //   stabilimento (richiedi-reset-cliente manager-driven). In questo caso
  //   ownership check sostituisce SERVICE_KEY come trust boundary.
  if (tipo === "recupero_password" && !isServiceRole) {
    if (!callerUserId || stab.proprietario_id !== callerUserId) {
      return jsonResponse({ error: "Non sei il proprietario di questo stabilimento" }, 403);
    }
  }

  if (!stab.wa_enabled) {
    return jsonResponse({ ok: false, skipped: "wa_disabled" }, 200);
  }

  // Carica il cliente (telefono + consenso + nome).
  const { data: cliente, error: cliErr } = await anonClient
    .from("clienti_stagionali")
    .select("id, nome, cognome, email, telefono, whatsapp_consenso")
    .eq("id", cliente_id)
    .single();

  if (cliErr || !cliente) {
    return jsonResponse({ error: "Cliente non trovato" }, 404);
  }

  // Il recupero password è una comunicazione di servizio richiesta esplicitamente
  // dall'utente: non rientra nei consensi marketing, quindi bypassa il controllo.
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
  // spiaggiamia_registrazione_medium (vars {{3}}) e spiaggiamia_operazione_warm
  // (vars {{6}}). Il frontend (js/main.js) intercetta ?login= e pre-compila
  // il campo login-identifier, che accetta sia email sia telefono (vedi
  // js/auth.js doLogin + normalizzaTelefonoIT).
  //
  // Fallback: email se presente, altrimenti telefono normalizzato. URL-encode
  // sempre, perché Twilio Content Templates non fanno auto-encoding (vedi
  // esempi variabili nei template Twilio: mario.rossi%40example.com).
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
      // {{3}} è il placeholder dentro il button URL del template
      // spiaggiamia_invito_stagionale:
      //   https://spiaggiamia.com/?invito={{3}}
      "3": token,
    };
  } else if (tipo === "benvenuto") {
    contentSid = WA_SID_BENVENUTO;
    contentVariables = {
      "1": nome,
      "2": stabilimentoNome,
      // {{3}} = loginIdentifier per il button URL del template
      // spiaggiamia_registrazione_medium: https://spiaggiamia.com/?login={{3}}
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
    // L'env var conserva il nome WA_SID_SUBAFFITTO per non richiedere
    // re-configurazione dei secret in Supabase.
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
    // Template Meta non ancora approvato: graceful skip senza errore.
    if (!WA_SID_RECUPERO) {
      return jsonResponse({ ok: false, skipped: "template_recupero_non_configurato" }, 200);
    }
    contentSid = WA_SID_RECUPERO;
    contentVariables = {
      "1": stabilimentoNome, // header
      "2": nome,
      "3": stabilimentoNome, // body
      "4": link,             // recovery URL
    };
  } else {
    return jsonResponse({ error: "tipo non valido" }, 400);
  }

  const result = await twilioSend(phone, contentSid, contentVariables);

  console.log(`WA ${tipo} → ${phone}: ${JSON.stringify(result)}`);
  return jsonResponse(result, 200);
});
