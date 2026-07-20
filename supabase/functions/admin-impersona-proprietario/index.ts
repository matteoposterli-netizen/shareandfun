// Edge Function: admin-impersona-proprietario
// Genera un magic link per far entrare un admin nel contesto (sessione reale,
// scrivibile) di uno stabilimento, agendo come il proprietario.
//
// Il link viene aperto dall'admin in una NUOVA scheda (window.open) e stabilisce
// una sessione supabase come il proprietario. La scheda admin originale resta
// autenticata come admin (sessionStorage isolato per scheda lato client).
//
// Input:  { stabilimento_id: string, redirect_origin: string }
// Output: { ok: true, link: string } oppure { error: string } con status HTTP.
//
// Sicurezza:
// - verify_jwt = true al gateway (vedi config.toml): richiede una sessione
//   valida, non chiamabile anonimamente.
// - Il chiamante deve essere presente in public.admins, altrimenti 403.
//
// Pattern (client service-role, generateLink, gestione errori, CORS) allineato
// a recupero-password/index.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Valida l'identità del chiamante dal JWT nell'header Authorization.
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!jwt) {
      return jsonResponse({ error: "Autenticazione richiesta" }, 401);
    }
    const { data: ud, error: authErr } = await supabaseAdmin.auth.getUser(jwt);
    const callerId = ud?.user?.id;
    const callerEmail = ud?.user?.email ?? null;
    if (authErr || !callerId) {
      return jsonResponse({ error: "Non autorizzato" }, 401);
    }

    // 2) Il chiamante deve essere un admin (public.admins).
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from("admins")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();
    if (adminErr) {
      console.error("admin-impersona lookup admins error", adminErr);
      return jsonResponse({ error: "Errore interno" }, 500);
    }
    if (!adminRow) {
      return jsonResponse({ error: "Non autorizzato" }, 403);
    }

    // 3) Input + risoluzione proprietario_id dallo stabilimento target.
    const body = await req.json().catch(() => ({}));
    const stabilimentoId: string = body.stabilimento_id || "";
    const redirectOrigin: string = body.redirect_origin || "";
    if (!stabilimentoId) {
      return jsonResponse({ error: "stabilimento_id mancante" }, 400);
    }
    if (!redirectOrigin) {
      return jsonResponse({ error: "redirect_origin mancante" }, 400);
    }

    const { data: stab, error: stabErr } = await supabaseAdmin
      .from("stabilimenti")
      .select("id, nome, proprietario_id")
      .eq("id", stabilimentoId)
      .maybeSingle();
    if (stabErr) {
      console.error("admin-impersona lookup stabilimento error", stabErr);
      return jsonResponse({ error: "Errore interno" }, 500);
    }
    if (!stab || !stab.proprietario_id) {
      return jsonResponse({ error: "Stabilimento o proprietario non trovato" }, 404);
    }

    // 4) Email reale del proprietario da auth.users.
    const { data: ownerData, error: ownerErr } =
      await supabaseAdmin.auth.admin.getUserById(stab.proprietario_id);
    if (ownerErr || !ownerData?.user?.email) {
      console.error("admin-impersona getUserById error", ownerErr);
      return jsonResponse({ error: "Email proprietario non trovata" }, 404);
    }
    const ownerEmail = ownerData.user.email;

    // 5) redirectTo calcolato dall'origine passata dal client (funziona sia su
    //    preview Vercel sia in produzione).
    const redirectTo = `${redirectOrigin}/index.html?impersonated=1`;

    // 6) Magic link.
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: ownerEmail,
      options: { redirectTo },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      console.error("admin-impersona generateLink error", linkErr);
      return jsonResponse({ error: "Generazione link fallita" }, 500);
    }
    const actionLink = linkData.properties.action_link;

    // 7) Audit log dell'impersonazione (rispetta i CHECK constraint esistenti:
    //    actor_type='admin', entity_type='auth', action='login').
    const { error: auditErr } = await supabaseAdmin.from("audit_log").insert({
      stabilimento_id: stabilimentoId,
      actor_type: "admin",
      actor_id: callerId,
      actor_label: callerEmail,
      entity_type: "auth",
      action: "login",
      description: "Sessione impersonata avviata dall'admin per conto del proprietario",
    });
    if (auditErr) {
      // Non bloccante: l'impersonazione può procedere anche se il log fallisce.
      console.error("admin-impersona audit_log insert error", auditErr);
    }

    // 8) Ritorna il link generato.
    return jsonResponse({ ok: true, link: actionLink });
  } catch (e) {
    console.error("admin-impersona eccezione", e);
    return jsonResponse({ error: "Errore interno" }, 500);
  }
});
