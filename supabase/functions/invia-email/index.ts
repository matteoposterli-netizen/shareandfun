import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "ShareAndFun <noreply@condombrellone.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface EmailRequest {
  tipo: "benvenuto" | "attesa" | "approvazione" | "invito";
  email: string;
  nome: string;
  cognome?: string;
  stabilimento_nome: string;
  stabilimento_telefono?: string;
  stabilimento_email?: string;
  ombrellone?: string;
  invite_link?: string;
  // Testi personalizzati dall'owner
  oggetto_custom?: string;
  testo_custom?: string;
}

function buildEmailHtml(opts: {
  headerColor: string;
  headerEmoji: string;
  headerSub: string;
  nome: string;
  testoPrincipale: string;
  boxColor: string;
  boxBorderColor: string;
  boxTitoloColor: string;
  boxTitolo: string;
  boxTesto: string;
  ctaLabel?: string;
  ctaLink?: string;
  stabilimento_nome: string;
  stabilimento_telefono?: string;
  stabilimento_email?: string;
  footer_extra?: string;
}): string {
  const cta = opts.ctaLabel && opts.ctaLink
    ? `<div style="text-align:center;margin:24px 0">
        <a href="${opts.ctaLink}" style="background:#1B6CA8;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block">${opts.ctaLabel}</a>
       </div>`
    : "";

  const contatti = [
    opts.stabilimento_telefono ? `📞 ${opts.stabilimento_telefono}` : "",
    opts.stabilimento_email ? `✉️ ${opts.stabilimento_email}` : "",
  ].filter(Boolean).join("&nbsp;&nbsp;·&nbsp;&nbsp;");

  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(27,108,168,0.1)">
        <tr><td style="background:${opts.headerColor};padding:36px 40px 28px;text-align:center">
          <div style="font-size:36px;margin-bottom:8px">${opts.headerEmoji}</div>
          <div style="font-family:Georgia,serif;font-size:26px;color:#ffffff;font-weight:bold">ShareAndFun</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px">${opts.headerSub}</div>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 6px;font-size:13px;color:#9AAABB">Ciao,</p>
          <h1 style="margin:0 0 20px;font-size:21px;color:#1A2332">${opts.nome}!</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#5A6A7A;line-height:1.7">${opts.testoPrincipale}</p>
          <div style="background:${opts.boxColor};border:1px solid ${opts.boxBorderColor};border-radius:8px;padding:18px 20px;margin-bottom:24px">
            <div style="font-size:12px;font-weight:700;color:${opts.boxTitoloColor};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">${opts.boxTitolo}</div>
            <p style="margin:0;font-size:14px;color:#5A6A7A;line-height:1.6">${opts.boxTesto}</p>
          </div>
          ${cta}
          ${opts.footer_extra ? `<p style="font-size:13px;color:#5A6A7A;line-height:1.6;margin-bottom:0">${opts.footer_extra}</p>` : ""}
        </td></tr>
        <tr><td style="background:#F5F0E8;padding:20px 40px;text-align:center;border-top:1px solid #E8DDD0">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#1A2332">🏖️ ${opts.stabilimento_nome}</p>
          ${contatti ? `<p style="margin:0 0 8px;font-size:12px;color:#9AAABB">${contatti}</p>` : ""}
          <p style="margin:0;font-size:12px;color:#9AAABB">Per qualsiasi necessità contatta direttamente il tuo stabilimento balneare.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: EmailRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body non valido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { tipo, email, nome, cognome = "", stabilimento_nome, stabilimento_telefono, stabilimento_email, ombrellone, invite_link, oggetto_custom, testo_custom } = body;

  if (!tipo || !email || !nome) {
    return new Response(JSON.stringify({ error: "Parametri mancanti: tipo, email, nome" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let subject: string;
  let html: string;

  if (tipo === "attesa") {
    subject = oggetto_custom || `Richiesta di iscrizione ricevuta — ${stabilimento_nome}`;
    const testoCustom = testo_custom || "La tua richiesta di iscrizione è stata ricevuta con successo. Il proprietario la esaminerà a breve e riceverai una notifica non appena sarà elaborata.";
    html = buildEmailHtml({
      headerColor: "linear-gradient(135deg,#1B6CA8 0%,#2B8DC8 100%)",
      headerEmoji: "🌊 ☂️",
      headerSub: `${stabilimento_nome}`,
      nome,
      testoPrincipale: `Grazie per esserti registrato su <strong>ShareAndFun</strong>!`,
      boxColor: "#FDF8E8",
      boxBorderColor: "#F0B429",
      boxTitoloColor: "#856404",
      boxTitolo: "⏳ Approvazione in attesa",
      boxTesto: testoCustom,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Hai dubbi? Contatta direttamente <strong>${stabilimento_nome}</strong> — siamo qui per te!`,
    });

  } else if (tipo === "approvazione") {
    subject = oggetto_custom || `La tua iscrizione è stata approvata — ${stabilimento_nome}`;
    const testoCustom = testo_custom || "Ottima notizia! La tua iscrizione è stata approvata. Puoi ora accedere a tutte le funzionalità della piattaforma.";
    html = buildEmailHtml({
      headerColor: "linear-gradient(135deg,#2EAA6B 0%,#38c97e 100%)",
      headerEmoji: "✅ 🌊",
      headerSub: "Iscrizione approvata!",
      nome,
      testoPrincipale: `Il proprietario di <strong>${stabilimento_nome}</strong> ha approvato la tua iscrizione.`,
      boxColor: "#E8F8F0",
      boxBorderColor: "#2EAA6B",
      boxTitoloColor: "#1a7a4a",
      boxTitolo: "🎉 Accesso completo attivo",
      boxTesto: testoCustom,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Buona stagione! ☀️ Per qualsiasi necessità il team di <strong>${stabilimento_nome}</strong> è sempre a disposizione.`,
    });

  } else if (tipo === "benvenuto") {
    subject = oggetto_custom || `Benvenuto su ShareAndFun — ${stabilimento_nome}`;
    const testoCustom = testo_custom || "Siamo felicissimi di averti con noi per questa stagione! Il tuo account è attivo e puoi già accedere alla piattaforma.";
    const ombrelloneText = ombrellone ? `Il tuo ombrellone è <strong>${ombrellone}</strong>. ` : "";
    html = buildEmailHtml({
      headerColor: "linear-gradient(135deg,#E07B54 0%,#f09060 100%)",
      headerEmoji: "☀️ ☂️",
      headerSub: `${stabilimento_nome} ti dà il benvenuto!`,
      nome,
      testoPrincipale: `Benvenuto su <strong>ShareAndFun</strong>! ${ombrelloneText}`,
      boxColor: "#FDF0EB",
      boxBorderColor: "#E07B54",
      boxTitoloColor: "#a05030",
      boxTitolo: "🏖️ Inizia subito",
      boxTesto: testoCustom,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Non vediamo l'ora di vederti in spiaggia! 🌊 Per qualsiasi necessità contatta direttamente <strong>${stabilimento_nome}</strong>.`,
    });

  } else if (tipo === "invito") {
    subject = `Sei stato invitato su ShareAndFun — ${stabilimento_nome}`;
    html = buildEmailHtml({
      headerColor: "linear-gradient(135deg,#1B6CA8 0%,#2B8DC8 100%)",
      headerEmoji: "🌊 ☂️",
      headerSub: `${stabilimento_nome} ti invita`,
      nome,
      testoPrincipale: `<strong>${stabilimento_nome}</strong> ti ha invitato a registrarti su <strong>ShareAndFun</strong>, la piattaforma per la gestione degli ombrelloni stagionali.`,
      boxColor: "#E8F4FD",
      boxBorderColor: "#4A9FD4",
      boxTitoloColor: "#1B6CA8",
      boxTitolo: "✉️ Completa la tua registrazione",
      boxTesto: "Clicca il pulsante qui sotto per completare la registrazione in pochi secondi. I tuoi dati sono già stati pre-compilati!",
      ctaLabel: "Completa la registrazione →",
      ctaLink: invite_link ?? "#",
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Hai ricevuto questa email perché il tuo stabilimento ti ha invitato. Per qualsiasi domanda contatta direttamente <strong>${stabilimento_nome}</strong>.`,
    });

  } else {
    return new Response(JSON.stringify({ error: "Tipo non valido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY non configurata — email non inviata");
    return new Response(JSON.stringify({ error: "RESEND_API_KEY non configurata sul server" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const payload: Record<string, unknown> = { from: FROM_EMAIL, to: email, subject, html };
  if (stabilimento_email) payload.reply_to = stabilimento_email;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    return new Response(JSON.stringify({ error: err }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const data = await res.json();
  return new Response(JSON.stringify({ success: true, id: data.id }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
