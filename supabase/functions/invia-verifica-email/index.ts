// Edge Function: invia-verifica-email
// Genera un magic link di verifica per l'email di ACCESSO del proprietario che
// si e' appena auto-registrato e lo invia via email (tipo "conferma_email"
// della function invia-email). Il proprietario deve cliccare il link per
// confermare la propria email prima di poter proseguire con il setup dello
// stabilimento o accedere al manager.
//
// Input:  { redirect_origin: string }
// Output: { ok: true } oppure { error: string } con status HTTP.
//
// NOTA: l'email da verificare e' SEMPRE quella del chiamante stesso
// (ud.user.email dal JWT). NON viene mai letta dal body, per evitare che si
// generino link di verifica per account altrui.
//
// Sicurezza:
// - verify_jwt = true al gateway (vedi config.toml): richiede una sessione
//   valida, non chiamabile anonimamente.
// - Pattern (client service-role, getUser dal JWT, generateLink, allow-list
//   redirect_origin, CORS) allineato a admin-impersona-proprietario/index.ts.

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

// Allow-list esplicita per redirect_origin: l'origine arriva dal client
// (location.origin) e viene usata per costruire il redirectTo del magic link,
// quindi va validata server-side invece di fidarsi ciecamente dell'input.
// Stesso identico criterio di admin-impersona-proprietario (dominio produzione
// + pattern preview Vercel di questo progetto — non allargarla).
function isAllowedOrigin(origin: string): boolean {
  if (origin === "https://spiaggiamia.com") return true;
  if (origin === "https://www.spiaggiamia.com") return true;
  // Preview Vercel di QUESTO progetto (owner/team specifico, non *.vercel.app
  // generico — quel dominio è hosting condiviso, un wildcard troppo ampio
  // vanificherebbe l'allow-list).
  if (/^https:\/\/shareandfun-[a-z0-9-]+-matteoposterli-8649s-projects\.vercel\.app$/.test(origin)) return true;
  return false;
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
    //    L'email da verificare e' SEMPRE quella del chiamante stesso.
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!jwt) {
      return jsonResponse({ error: "Autenticazione richiesta" }, 401);
    }
    const { data: ud, error: authErr } = await supabaseAdmin.auth.getUser(jwt);
    const callerId = ud?.user?.id;
    const callerEmail = ud?.user?.email ?? null;
    if (authErr || !callerId || !callerEmail) {
      return jsonResponse({ error: "Non autorizzato" }, 401);
    }

    // 2) Input: solo redirect_origin (validato con l'allow-list).
    const body = await req.json().catch(() => ({}));
    const redirectOrigin: string = body.redirect_origin || "";
    if (!redirectOrigin) {
      return jsonResponse({ error: "redirect_origin mancante" }, 400);
    }
    if (!isAllowedOrigin(redirectOrigin)) {
      return jsonResponse({ error: "redirect_origin non consentito" }, 400);
    }

    // 3) redirectTo: al ritorno la SPA legge ?verifica_email=1 e chiama la RPC
    //    conferma_email_proprietario() per marcare l'email come verificata.
    const redirectTo = `${redirectOrigin}/?verifica_email=1`;

    // 4) Magic link verso l'email del chiamante.
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: callerEmail,
      options: { redirectTo },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      console.error("invia-verifica-email generateLink error", linkErr);
      return jsonResponse({ error: "Generazione link fallita" }, 500);
    }
    const actionLink = linkData.properties.action_link;

    // 5) Nome del proprietario dal profilo (best-effort, per personalizzare
    //    l'email). Se non disponibile passiamo stringa vuota: la function
    //    invia-email usa "Ciao ," come fallback neutro.
    let nome = "";
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("nome")
        .eq("id", callerId)
        .maybeSingle();
      nome = prof?.nome ?? "";
    } catch (e) {
      console.error("invia-verifica-email lookup profilo error", e);
    }

    // 6) Invio email SERVER-TO-SERVER: chiamiamo invia-email con
    //    Authorization: Bearer <SERVICE_KEY> (invia-email accetta questo
    //    bypass, vedi il controllo `jwt !== SUPABASE_SERVICE_KEY`).
    //    NON e' fire-and-forget: se l'invio fallisce l'utente resta bloccato,
    //    quindi propaghiamo l'errore al chiamante.
    const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/invia-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        tipo: "conferma_email",
        email: callerEmail,
        nome,
        stabilimento_nome: "SpiaggiaMia",
        ctaLink: actionLink,
      }),
    });
    if (!emailRes.ok) {
      const errTxt = await emailRes.text();
      console.error("invia-verifica-email invia-email fallita:", errTxt);
      return jsonResponse({ error: "Invio email fallito" }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    console.error("invia-verifica-email eccezione", e);
    return jsonResponse({ error: "Errore interno" }, 500);
  }
});
