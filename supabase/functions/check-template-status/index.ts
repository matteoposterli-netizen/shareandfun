// Edge Function: check-template-status
// Interroga Twilio Content API per ottenere lo status di approval dei template
// WhatsApp spiaggiamia_*, e ritorna anche lo stato dei secret WA_SID_*
// attualmente settati (read-only). Richiede autenticazione utente (verify_jwt).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

const SECRET_KEYS = [
  "WA_SID_INVITO",
  "WA_SID_BENVENUTO",
  "WA_SID_SUBAFFITTO",
  "WA_SID_RECUPERO",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return new Response(
      JSON.stringify({
        error: "Missing Twilio credentials in Supabase secrets",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const url =
      "https://content.twilio.com/v2/ContentAndApprovals?ContentName=spiaggiamia&PageSize=50";

    const r = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    const raw = await r.text();

    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: "Twilio API error",
          status: r.status,
          body: raw,
        }),
        {
          status: r.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const data = JSON.parse(raw);
    const templates = (data.contents || []).map((c: any) => {
      const ar = c.approval_requests || {};
      return {
        template: c.friendly_name,
        sid: c.sid,
        language: c.language,
        date_updated: c.date_updated,
        content_types: c.types ? Object.keys(c.types) : [],
        status: ar.status ?? "unsubmitted",
        category: ar.category ?? null,
        allow_category_change: ar.allow_category_change ?? null,
        rejection_reason: ar.rejection_reason ?? null,
      };
    });

    // Ordino: rejected prima, poi pending, poi approved, poi unsubmitted
    const order: Record<string, number> = {
      rejected: 0,
      pending: 1,
      received: 2,
      approved: 3,
      unsubmitted: 4,
    };
    templates.sort(
      (a: any, b: any) =>
        (order[a.status] ?? 99) - (order[b.status] ?? 99),
    );

    // secrets_check: per ogni WA_SID_* esponi il valore + il template
    // corrispondente trovato nella lista. I SID Twilio non sono sensibili.
    const sidIndex: Record<string, any> = {};
    for (const t of templates) {
      sidIndex[t.sid] = t;
    }
    const secretsCheck: Record<string, any> = {};
    for (const key of SECRET_KEYS) {
      const val = Deno.env.get(key);
      if (!val) {
        secretsCheck[key] = {
          value: null,
          operational: false,
          warning: "Secret NON settato",
        };
        continue;
      }
      const match = sidIndex[val];
      if (!match) {
        secretsCheck[key] = {
          value: val,
          matches_template: null,
          template_status: null,
          template_category: null,
          operational: false,
          warning:
            "Il SID nel secret NON corrisponde a nessun template spiaggiamia_*",
        };
        continue;
      }
      const operational = match.status === "approved";
      secretsCheck[key] = {
        value: val,
        matches_template: match.template,
        template_status: match.status,
        template_category: match.category,
        operational,
        warning: operational
          ? null
          : `Template in stato '${match.status}' - non ancora operativo`,
      };
    }

    return new Response(
      JSON.stringify(
        {
          fetched_at: new Date().toISOString(),
          count: templates.length,
          templates,
          secrets_check: secretsCheck,
        },
        null,
        2,
      ),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
