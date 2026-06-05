// Edge Function: recupero-password
// Gestisce SOLO il ramo telefono del recupero password.
// Il ramo email e' gestito direttamente lato client tramite
// supabase.auth.resetPasswordForEmail().
//
// Input: { identificatore: string, canale: 'telefono' }
// Output sempre generico: { ok: true } per evitare enumeration.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

// Coerente con _normalize_phone_e164 SQL e normalizzaTelefonoIT in js/utils.js
function normalizzaTelefono(raw: string): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) return s;
  if (s.startsWith("3")) return "+39" + s;
  if (s.startsWith("0")) return "+39" + s;
  return "+" + s;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: jsonHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const identificatore: string = body.identificatore || "";
    const canale: string = body.canale || "";

    if (!identificatore || canale !== "telefono") {
      // Risposta sempre generica anche per input invalidi
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    const tel = normalizzaTelefono(identificatore);
    if (!tel) {
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Trova cliente registrato con questo telefono
    const { data: cliente, error: cliErr } = await supabase
      .from("clienti_stagionali")
      .select("id, user_id, nome, cognome, telefono, stabilimento_id, whatsapp_consenso")
      .eq("telefono", tel)
      .not("user_id", "is", null)
      .maybeSingle();

    if (cliErr) {
      console.error("recupero-password lookup error", cliErr);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }
    if (!cliente) {
      // Nessun match: risposta generica
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    // 2) Recupera email su auth.users (vera o sintetica)
    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(cliente.user_id);
    if (userErr || !userData?.user?.email) {
      console.error("recupero-password getUserById error", userErr);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }
    const authEmail = userData.user.email;

    // 3) Genera magic link di recovery
    const APP_URL = Deno.env.get("APP_URL") || "https://spiaggiamia.com";
    const redirectTo = `${APP_URL}/?reset=1`;
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: authEmail,
      options: { redirectTo },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      console.error("recupero-password generateLink error", linkErr);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }
    const recoveryLink = linkData.properties.action_link;

    // 4) Carica stabilimento
    const { data: stab } = await supabase
      .from("stabilimenti")
      .select("id, nome, wa_enabled")
      .eq("id", cliente.stabilimento_id)
      .maybeSingle();

    if (!stab?.wa_enabled) {
      // WA non abilitato: niente invio (risposta generica)
      console.log("recupero-password skip: WA disabled per stabilimento", cliente.stabilimento_id);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    // 5) Invio via invia-whatsapp (tipo: recupero_password)
    //
    // BUGFIX 5 giu 2026 (parallelo a quello di richiedi-reset-cliente): il
    // template Meta-approved 'spiaggiamia_recupero_password_v3' ha button
    // URL "https://...supabase.co/auth/v1/verify{{4}}" (SENZA '?' tra
    // 'verify' e '{{4}}'). Prima del fix passavamo l'intero recoveryLink
    // (URL completo) come variabile {{4}}: risultato ricomposto era
    // 'verifyhttps://...supabase.co/auth/v1/verify?token=...' (doppio
    // schema/path) -> browser apriva pagina bianca o 404. Fix: estrarre la
    // sola query string del recoveryLink, includendo il '?' iniziale, e
    // passarla come {{4}}. Il template ricompone l'URL corretto
    // 'verify' + '?token=...&type=recovery&redirect_to=...' che e'
    // esattamente l'action_link Supabase originale. Notare che Meta NON
    // URL-encoda '=' e '&' della variabile (confermato empiricamente
    // dall'URL del bottone copiato dal cellulare), quindi non serve
    // ridisegnare con short-link.
    const recoveryUrl = new URL(recoveryLink);
    const recoveryQuery = recoveryUrl.search; // include '?' iniziale

    const waRes = await fetch(`${SUPABASE_URL}/functions/v1/invia-whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        tipo: "recupero_password",
        stabilimento_id: cliente.stabilimento_id,
        cliente_id: cliente.id,
        telefono: cliente.telefono,
        nome: cliente.nome,
        cognome: cliente.cognome,
        link: recoveryQuery, // query string con '?' iniziale (vedi BUGFIX 5 giu 2026 sopra)
        stabilimento_nome: stab.nome,
      }),
    });
    if (!waRes.ok) {
      const errBody = await waRes.json().catch(() => ({}));
      console.error("recupero-password WA invio fallito", errBody);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  } catch (e) {
    console.error("recupero-password eccezione", e);
    // Anche su errore: risposta generica
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: jsonHeaders });
  }
});
