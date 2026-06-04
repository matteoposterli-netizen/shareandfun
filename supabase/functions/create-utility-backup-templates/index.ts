// Edge Function: create-utility-backup-templates
// Crea + sottomette a Twilio/Meta 9 template WhatsApp di BACKUP, tutti come
// UTILITY, in 3 livelli di calore (safe/medium/warm) per ognuno dei 3 eventi
// (accesso / registrazione / operazione). Set parallelo ai 3 stagionali attuali
// in appeal MARKETING. Richiede POST con body di conferma.
//
// Body bodies ottimizzati dopo lettura policy Meta (incipit transazionale,
// niente parole-trigger MARKETING, emoji limitate a ✅ 🏖️ ☀️, nessuna variabile
// in posizioni terminali di header/body).
//
// Pattern di scaffolding identico a recreate-whatsapp-templates.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

// Pattern URL bottoni — coerente col frontend (window.location.origin + /?invito=
// / /?login=) e con il template esistente spiaggiamia_invito_stagionale.
const INVITO_URL = "https://spiaggiamia.com/?invito={{3}}";
const LOGIN_URL_B = "https://spiaggiamia.com/?login={{3}}";
const LOGIN_URL_C = "https://spiaggiamia.com/?login={{6}}";

// SID del template invito esistente: letto in fase di pre-step per confermare
// che il pattern URL del bottone coincida (host + path + param + posizione var).
const INVITO_REFERENCE_SID = "HXcf66089cb849dfcd69bfec8bd5dffe71";

interface TemplateSpec {
  friendly_name: string;
  event: "accesso" | "registrazione" | "operazione";
  level: "safe" | "medium" | "warm";
  body: string;
  buttonTitle: string;
  buttonUrl: string;
  variables: Record<string, string>;
}

const TEMPLATES: TemplateSpec[] = [
  // ── GRUPPO A — ACCESSO ────────────────────────────────────────────────────
  {
    friendly_name: "spiaggiamia_accesso_safe",
    event: "accesso",
    level: "safe",
    body:
      "Attivazione account\n\n" +
      "Ciao {{1}}, è stata creata un'utenza a tuo nome presso lo stabilimento {{2}}.\n\n" +
      "Tocca il pulsante qui sotto per impostare la password e completare l'attivazione.\n\n" +
      "Se non riconosci la richiesta, ignora questo messaggio.",
    buttonTitle: "Imposta password",
    buttonUrl: INVITO_URL,
    variables: { "1": "Mario", "2": "Stabilimento Universo", "3": "abc123token" },
  },
  {
    friendly_name: "spiaggiamia_accesso_medium",
    event: "accesso",
    level: "medium",
    body:
      "✅ Attivazione account\n\n" +
      "Ciao {{1}}, è stata creata un'utenza a tuo nome presso lo stabilimento {{2}} per la stagione 🏖️\n\n" +
      "Tocca il pulsante qui sotto per impostare la password e completare l'attivazione.\n\n" +
      "Se non riconosci la richiesta, ignora questo messaggio.",
    buttonTitle: "Imposta password",
    buttonUrl: INVITO_URL,
    variables: { "1": "Mario", "2": "Stabilimento Universo", "3": "abc123token" },
  },
  {
    friendly_name: "spiaggiamia_accesso_warm",
    event: "accesso",
    level: "warm",
    body:
      "☀️ Attivazione account SpiaggiaMia\n\n" +
      "Ciao {{1}}! Lo stabilimento {{2}} ha attivato la tua utenza per la stagione 🏖️\n\n" +
      "Tocca il pulsante qui sotto per impostare la password e accedere alla tua area personale.\n\n" +
      "Se non riconosci la richiesta, ignora questo messaggio.",
    buttonTitle: "Imposta password",
    buttonUrl: INVITO_URL,
    variables: { "1": "Mario", "2": "Stabilimento Universo", "3": "abc123token" },
  },

  // ── GRUPPO B — REGISTRAZIONE ──────────────────────────────────────────────
  {
    friendly_name: "spiaggiamia_registrazione_safe",
    event: "registrazione",
    level: "safe",
    body:
      "Conferma registrazione account\n\n" +
      "Ciao {{1}}, la tua registrazione presso {{2}} è stata completata.\n\n" +
      "Tocca il pulsante qui sotto per accedere alla tua area riservata, dove potrai consultare ombrellone, periodo e saldo crediti.",
    buttonTitle: "Accedi alla tua area",
    buttonUrl: LOGIN_URL_B,
    variables: { "1": "Mario", "2": "Stabilimento Universo", "3": "mario.rossi%40example.com" },
  },
  {
    friendly_name: "spiaggiamia_registrazione_medium",
    event: "registrazione",
    level: "medium",
    body:
      "✅ Conferma registrazione account\n\n" +
      "Ciao {{1}}, la tua registrazione presso {{2}} è completata 🏖️\n\n" +
      "Tocca il pulsante qui sotto per accedere alla tua area riservata, dove potrai consultare ombrellone, periodo e saldo crediti.",
    buttonTitle: "Accedi alla tua area",
    buttonUrl: LOGIN_URL_B,
    variables: { "1": "Mario", "2": "Stabilimento Universo", "3": "mario.rossi%40example.com" },
  },
  {
    friendly_name: "spiaggiamia_registrazione_warm",
    event: "registrazione",
    level: "warm",
    body:
      "☀️ Conferma registrazione SpiaggiaMia\n\n" +
      "Ciao {{1}}! La tua registrazione presso {{2}} è completata.\n\n" +
      "Tocca il pulsante qui sotto per accedere alla tua area riservata e consultare ombrellone, periodo e saldo crediti per la stagione 🏖️",
    buttonTitle: "Accedi alla tua area",
    buttonUrl: LOGIN_URL_B,
    variables: { "1": "Mario", "2": "Stabilimento Universo", "3": "mario.rossi%40example.com" },
  },

  // ── GRUPPO C — OPERAZIONE ─────────────────────────────────────────────────
  {
    friendly_name: "spiaggiamia_operazione_safe",
    event: "operazione",
    level: "safe",
    body:
      "Riepilogo operazione\n\n" +
      "Ciao {{1}}, è stata registrata un'operazione sul tuo account presso {{5}}:\n\n" +
      "- Periodo: {{2}}\n" +
      "- Variazione credito: {{3}}\n" +
      "- Saldo aggiornato: {{4}}\n\n" +
      "Tocca il pulsante qui sotto per accedere alla tua area riservata e vedere tutti i dettagli.",
    buttonTitle: "Accedi alla tua area",
    buttonUrl: LOGIN_URL_C,
    variables: {
      "1": "Mario",
      "2": "01/07-15/07",
      "3": "+50",
      "4": "320",
      "5": "Stabilimento Universo",
      "6": "mario.rossi%40example.com",
    },
  },
  {
    friendly_name: "spiaggiamia_operazione_medium",
    event: "operazione",
    level: "medium",
    body:
      "✅ Riepilogo operazione\n\n" +
      "Ciao {{1}}, è stata registrata un'operazione sul tuo account presso {{5}} 🏖️\n\n" +
      "- Periodo: {{2}}\n" +
      "- Variazione credito: {{3}}\n" +
      "- Saldo aggiornato: {{4}}\n\n" +
      "Tocca il pulsante qui sotto per accedere alla tua area riservata e vedere tutti i dettagli.",
    buttonTitle: "Accedi alla tua area",
    buttonUrl: LOGIN_URL_C,
    variables: {
      "1": "Mario",
      "2": "01/07-15/07",
      "3": "+50",
      "4": "320",
      "5": "Stabilimento Universo",
      "6": "mario.rossi%40example.com",
    },
  },
  {
    friendly_name: "spiaggiamia_operazione_warm",
    event: "operazione",
    level: "warm",
    body:
      "☀️ Aggiornamento account SpiaggiaMia\n\n" +
      "Ciao {{1}}! Abbiamo registrato un'operazione sul tuo account presso {{5}} per la stagione:\n\n" +
      "- Periodo: {{2}}\n" +
      "- Variazione credito: {{3}}\n" +
      "- Saldo aggiornato: {{4}}\n\n" +
      "Tocca il pulsante qui sotto per accedere alla tua area riservata e vedere tutti i dettagli.",
    buttonTitle: "Accedi alla tua area",
    buttonUrl: LOGIN_URL_C,
    variables: {
      "1": "Mario",
      "2": "01/07-15/07",
      "3": "+50",
      "4": "320",
      "5": "Stabilimento Universo",
      "6": "mario.rossi%40example.com",
    },
  },
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Use POST" }, 405);
  }
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return jsonResp({ error: "Missing Twilio credentials in env" }, 500);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonResp(
      { error: "Body must be JSON: { \"confirm\": \"yes-create-utility-backups\" }" },
      400,
    );
  }

  if (body?.confirm !== "yes-create-utility-backups") {
    return jsonResp(
      {
        error:
          "Missing or invalid confirmation. Send { \"confirm\": \"yes-create-utility-backups\" } in body.",
        available: TEMPLATES.map((t) => t.friendly_name),
      },
      400,
    );
  }

  // Filtro opzionale per test su un sottoinsieme di template.
  const targets: string[] | null =
    Array.isArray(body.targets) && body.targets.length > 0 ? body.targets : null;

  const authB64 = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const authHeader = { Authorization: `Basic ${authB64}` };

  // PRE-STEP: leggi il template invito esistente e riporta il pattern URL del
  // suo bottone, così da confermare al volo (con le credenziali reali) che il
  // pattern usato per il gruppo A coincida (host + path + param + posizione var).
  const invitoButtonReference = await readInvitoButtonPattern(authHeader);

  const toRun = targets
    ? TEMPLATES.filter((t) => targets.includes(t.friendly_name))
    : TEMPLATES;

  const results = [];
  for (const spec of toRun) {
    results.push(await createOne(spec, authHeader));
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.length - ok;

  return jsonResp({
    fetched_at: new Date().toISOString(),
    invito_button_reference: invitoButtonReference,
    results,
    summary: { ok, failed },
  });
});

// Legge il template invito esistente e ne estrae l'URL del bottone, per la
// verifica del pre-step. Non blocca la creazione in caso di errore.
async function readInvitoButtonPattern(authHeader: Record<string, string>) {
  try {
    const resp = await fetch(
      `https://content.twilio.com/v1/Content/${INVITO_REFERENCE_SID}`,
      { headers: authHeader },
    );
    if (!resp.ok) {
      return { sid: INVITO_REFERENCE_SID, status: "read_failed", httpStatus: resp.status };
    }
    const data = await resp.json();
    const cta = data?.types?.["twilio/call-to-action"];
    const urls = (cta?.actions || [])
      .filter((a: any) => a?.type === "URL")
      .map((a: any) => a?.url);
    return {
      sid: INVITO_REFERENCE_SID,
      friendly_name: data?.friendly_name,
      button_urls: urls,
      expected_group_a_url: INVITO_URL,
      note: "Confronta button_urls col pattern usato dal gruppo A (expected_group_a_url).",
    };
  } catch (err) {
    return { sid: INVITO_REFERENCE_SID, status: "exception", error: String(err) };
  }
}

async function createOne(
  spec: TemplateSpec,
  authHeader: Record<string, string>,
) {
  const log: string[] = [];
  const push = (msg: string) => {
    log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  };

  try {
    // 1) CREATE template
    const createPayload = {
      friendly_name: spec.friendly_name,
      language: "it",
      variables: spec.variables,
      types: {
        "twilio/call-to-action": {
          body: spec.body,
          actions: [
            {
              type: "URL",
              title: spec.buttonTitle,
              url: spec.buttonUrl,
            },
          ],
        },
      },
    };

    push(`Creating ${spec.friendly_name}...`);
    const createResp = await fetch("https://content.twilio.com/v1/Content", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(createPayload),
    });
    const createRaw = await createResp.text();
    if (!createResp.ok) {
      return {
        friendly_name: spec.friendly_name,
        event: spec.event,
        level: spec.level,
        status: "create_failed",
        httpStatus: createResp.status,
        body: createRaw,
        log,
      };
    }
    const created = JSON.parse(createRaw);
    const sid = created.sid;
    push(`Created SID ${sid}`);

    // 2) SUBMIT for WhatsApp approval (UTILITY, allow_category_change)
    push(`Submitting for WhatsApp approval (UTILITY)...`);
    const submitUrl = `https://content.twilio.com/v1/Content/${sid}/ApprovalRequests/whatsapp`;
    const submitResp = await fetch(submitUrl, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: spec.friendly_name,
        category: "UTILITY",
        allow_category_change: true,
      }),
    });
    const submitRaw = await submitResp.text();
    if (!submitResp.ok) {
      return {
        friendly_name: spec.friendly_name,
        event: spec.event,
        level: spec.level,
        status: "submit_failed",
        sid,
        httpStatus: submitResp.status,
        body: submitRaw,
        log,
      };
    }
    const submitted = JSON.parse(submitRaw);
    push(`Submitted. approval_status=${submitted.status}`);

    return {
      friendly_name: spec.friendly_name,
      event: spec.event,
      level: spec.level,
      status: "ok",
      sid,
      approvalStatus: submitted.status,
      log,
    };
  } catch (err) {
    return {
      friendly_name: spec.friendly_name,
      event: spec.event,
      level: spec.level,
      status: "exception",
      error: String(err),
      log,
    };
  }
}
