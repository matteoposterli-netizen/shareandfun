// Edge Function: recreate-whatsapp-templates
// Cancella e ricrea i 3 template WhatsApp bloccati su Twilio, mantenendo
// identico contenuto/variabili/tipo. Richiede POST con body di conferma.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

const TARGETS = [
  "spiaggiamia_invito_stagionale",
  "spiaggiamia_benvenuto_stagionale",
  "spiaggiamia_subaffitto_confermato",
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
      { error: "Body must be JSON: { \"confirm\": \"yes-delete-and-recreate\" }" },
      400,
    );
  }

  if (body?.confirm !== "yes-delete-and-recreate") {
    return jsonResp(
      {
        error:
          "Missing or invalid confirmation. Send { \"confirm\": \"yes-delete-and-recreate\" } in body.",
        targets: TARGETS,
      },
      400,
    );
  }

  // Permetti di override la lista di target via body.targets (array di string)
  // utile per test su un singolo template
  const targets: string[] =
    Array.isArray(body.targets) && body.targets.length > 0
      ? body.targets
      : TARGETS;

  const authB64 = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const authHeader = { Authorization: `Basic ${authB64}` };

  const results = [];
  for (const name of targets) {
    results.push(await processOne(name, authHeader));
  }

  return jsonResp({
    fetched_at: new Date().toISOString(),
    targets,
    results,
  });
});

async function processOne(
  friendlyName: string,
  authHeader: Record<string, string>,
) {
  const log: string[] = [];
  const push = (msg: string) => {
    log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  };

  try {
    // 1) Trova il template per friendly_name
    push(`Searching template ${friendlyName}...`);
    const listUrl =
      `https://content.twilio.com/v2/ContentAndApprovals?ContentName=${encodeURIComponent(friendlyName)}&PageSize=20`;
    const listResp = await fetch(listUrl, { headers: authHeader });
    if (!listResp.ok) {
      return {
        friendlyName,
        status: "list_failed",
        httpStatus: listResp.status,
        body: await listResp.text(),
        log,
      };
    }
    const listData = await listResp.json();
    const found = (listData.contents || []).find(
      (c: any) => c.friendly_name === friendlyName,
    );
    if (!found) {
      push(`Template not found, skipping.`);
      return { friendlyName, status: "not_found", log };
    }
    const oldSid = found.sid;
    push(`Found existing: ${oldSid}`);

    // 2) Leggi i dettagli completi (body, types, variables, language)
    const detailsUrl = `https://content.twilio.com/v1/Content/${oldSid}`;
    const detailsResp = await fetch(detailsUrl, { headers: authHeader });
    if (!detailsResp.ok) {
      return {
        friendlyName,
        oldSid,
        status: "read_failed",
        httpStatus: detailsResp.status,
        body: await detailsResp.text(),
        log,
      };
    }
    const details = await detailsResp.json();
    const types = details.types || {};
    push(`Fetched content. types=[${Object.keys(types).join(",")}] language=${details.language}`);

    // Salva snapshot del payload per ricreazione (rimuovo campi di sistema)
    const createPayload: Record<string, unknown> = {
      friendly_name: friendlyName,
      language: details.language || "it",
      variables: details.variables || {},
      types,
    };

    // 3) DELETE del vecchio
    push(`Deleting old SID ${oldSid}...`);
    const delResp = await fetch(detailsUrl, {
      method: "DELETE",
      headers: authHeader,
    });
    if (!delResp.ok && delResp.status !== 204) {
      return {
        friendlyName,
        oldSid,
        status: "delete_failed",
        httpStatus: delResp.status,
        body: await delResp.text(),
        log,
        createPayload,
      };
    }
    push(`Deleted.`);

    // 4) CREATE nuovo con stesso content
    push(`Creating new template...`);
    const createResp = await fetch("https://content.twilio.com/v1/Content", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(createPayload),
    });
    const createRaw = await createResp.text();
    if (!createResp.ok) {
      return {
        friendlyName,
        oldSid,
        status: "create_failed",
        httpStatus: createResp.status,
        body: createRaw,
        createPayload,
        log,
      };
    }
    const created = JSON.parse(createRaw);
    const newSid = created.sid;
    push(`Created new SID ${newSid}`);

    // 5) SUBMIT per WhatsApp approval (categoria UTILITY)
    push(`Submitting for WhatsApp approval...`);
    const submitUrl = `https://content.twilio.com/v1/Content/${newSid}/ApprovalRequests/whatsapp`;
    const submitResp = await fetch(submitUrl, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ name: friendlyName, category: "UTILITY" }),
    });
    const submitRaw = await submitResp.text();
    if (!submitResp.ok) {
      return {
        friendlyName,
        oldSid,
        newSid,
        status: "submit_failed",
        httpStatus: submitResp.status,
        body: submitRaw,
        log,
      };
    }
    const submitted = JSON.parse(submitRaw);
    push(`Submitted. approval_status=${submitted.status}`);

    return {
      friendlyName,
      status: "ok",
      oldSid,
      newSid,
      approvalStatus: submitted.status,
      log,
    };
  } catch (err) {
    return {
      friendlyName,
      status: "exception",
      error: String(err),
      log,
    };
  }
}
