import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "SpiaggiaMia <noreply@spiaggiamia.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Domini freemail noti: settare Reply-To su un freemail diverso dal From
// fa scattare la regola SpamAssassin FREEMAIL_FORGED_REPLYTO (-2.5).
// In quel caso il Reply-To resta sul From (noreply@spiaggiamia.com) e i
// contatti del proprietario vengono mostrati nel footer del template.
const FREEMAIL_DOMAIN_RE = /@(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|libero|virgilio|tin|alice|inwind|tiscali|email|iol|fastwebnet|icloud|me|mac|aol|gmx|protonmail|proton|tutanota|tutamail|yandex|mail|zoho|pec)\.[a-z.]{2,}$/i;
function isFreemail(addr: string | undefined | null): boolean {
  if (!addr) return false;
  return FREEMAIL_DOMAIN_RE.test(addr.trim().toLowerCase());
}

function buildFromHeader(displayName: string | undefined): string {
  if (!displayName) return FROM_EMAIL;
  const clean = displayName.replace(/["\r\n]/g, "").trim();
  if (!clean) return FROM_EMAIL;
  const match = FROM_EMAIL.match(/<([^>]+)>/);
  const email = match ? match[1] : FROM_EMAIL;
  return `"${clean}" <${email}>`;
}

interface EmailRequest {
  tipo: "benvenuto" | "attesa" | "approvazione" | "invito" | "credito_accreditato" | "credito_ritirato" | "chiusura_stagione" | "comunicazione";
  email: string;
  nome: string;
  cognome?: string;
  stabilimento_id?: string;
  stabilimento_nome: string;
  stabilimento_telefono?: string;
  stabilimento_email?: string;
  ombrellone?: string;
  invite_link?: string;
  login_link?: string;
  // Dati transazione coin (per tipi credito_accreditato/ritirato)
  importo_formatted?: string;
  saldo_formatted?: string;
  nota?: string;
  // Riepilogo stagionale (per tipo chiusura_stagione)
  gg_disponibilita?: number;
  gg_subaffittato?: number;
  coin_ricevuti_formatted?: string;
  coin_spesi_formatted?: string;
  // Testi personalizzati dall'owner
  oggetto_custom?: string;
  testo_custom?: string;
}

interface EmailContentOpts {
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
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildEmailText(opts: EmailContentOpts): string {
  const titolo = stripHtml(opts.boxTitolo);
  const linee: string[] = [
    `Ciao ${opts.nome},`,
    "",
    stripHtml(opts.testoPrincipale),
    "",
    titolo,
    stripHtml(opts.boxTesto),
  ];
  if (opts.ctaLabel && opts.ctaLink) {
    linee.push("", `${stripHtml(opts.ctaLabel)}: ${opts.ctaLink}`);
  }
  if (opts.footer_extra) {
    linee.push("", stripHtml(opts.footer_extra));
  }
  linee.push("", "—", opts.stabilimento_nome);
  if (opts.stabilimento_telefono) linee.push(`Tel: ${opts.stabilimento_telefono}`);
  if (opts.stabilimento_email) linee.push(`Email: ${opts.stabilimento_email}`);
  linee.push(
    "",
    "Questa è un'email automatica inviata da un indirizzo no-reply: le risposte non vengono lette.",
    `Per qualsiasi necessità contatta direttamente ${opts.stabilimento_nome} ai recapiti qui sopra.`,
  );
  return linee.join("\n");
}

function buildEmailHtml(opts: EmailContentOpts): string {
  const cta = opts.ctaLabel && opts.ctaLink
    ? `<div style="text-align:center;margin:24px 0">
        <a href="${opts.ctaLink}" style="background:#1B6CA8;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block">${opts.ctaLabel}</a>
       </div>`
    : "";

  const telLink = opts.stabilimento_telefono
    ? `<a href="tel:${opts.stabilimento_telefono.replace(/\s+/g, "")}" style="color:#1B6CA8;text-decoration:none">📞 ${opts.stabilimento_telefono}</a>`
    : "";
  const mailLink = opts.stabilimento_email
    ? `<a href="mailto:${opts.stabilimento_email}" style="color:#1B6CA8;text-decoration:none">✉️ ${opts.stabilimento_email}</a>`
    : "";
  const contatti = [telLink, mailLink].filter(Boolean).join("&nbsp;&nbsp;·&nbsp;&nbsp;");

  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(27,108,168,0.1)">
        <tr><td style="background:${opts.headerColor};padding:36px 40px 28px;text-align:center">
          <div style="font-size:36px;margin-bottom:8px">${opts.headerEmoji}</div>
          <div style="font-family:Georgia,serif;font-size:26px;color:#ffffff;font-weight:bold">SpiaggiaMia</div>
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
          <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#1A2332">🏖️ ${opts.stabilimento_nome}</p>
          ${contatti ? `<p style="margin:0 0 14px;font-size:13px;color:#1A2332;line-height:1.6">${contatti}</p>` : ""}
          <p style="margin:0 0 6px;font-size:11px;color:#9AAABB;line-height:1.5">Questa è un'email automatica inviata da un indirizzo <strong>no-reply</strong>: le risposte non vengono lette.</p>
          <p style="margin:0;font-size:11px;color:#9AAABB;line-height:1.5">Per qualsiasi necessità contatta direttamente <strong>${opts.stabilimento_nome}</strong> ai recapiti qui sopra.</p>
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

  const { tipo, email, nome, cognome = "", stabilimento_id, stabilimento_nome, stabilimento_telefono, stabilimento_email, ombrellone, invite_link, login_link, importo_formatted, saldo_formatted, nota, gg_disponibilita, gg_subaffittato, coin_ricevuti_formatted, coin_spesi_formatted, oggetto_custom, testo_custom } = body;

  if (!tipo || !email || !nome) {
    return new Response(JSON.stringify({ error: "Parametri mancanti: tipo, email, nome" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let subject: string;
  let opts: EmailContentOpts;

  if (tipo === "attesa") {
    subject = oggetto_custom || `Richiesta di iscrizione ricevuta — ${stabilimento_nome}`;
    const testoCustom = testo_custom || "La tua richiesta di iscrizione è stata ricevuta con successo. Il proprietario la esaminerà a breve e riceverai una notifica non appena sarà elaborata.";
    opts = {
      headerColor: "linear-gradient(135deg,#1B6CA8 0%,#2B8DC8 100%)",
      headerEmoji: "🌊 ☂️",
      headerSub: `${stabilimento_nome}`,
      nome,
      testoPrincipale: `Grazie per esserti registrato su <strong>SpiaggiaMia</strong>!`,
      boxColor: "#FDF8E8",
      boxBorderColor: "#F0B429",
      boxTitoloColor: "#856404",
      boxTitolo: "⏳ Approvazione in attesa",
      boxTesto: testoCustom,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Hai dubbi? Contatta direttamente <strong>${stabilimento_nome}</strong> — siamo qui per te!`,
    };

  } else if (tipo === "approvazione") {
    subject = oggetto_custom || `La tua iscrizione è stata approvata — ${stabilimento_nome}`;
    const testoCustom = testo_custom || "Ottima notizia! La tua iscrizione è stata approvata. Puoi ora accedere a tutte le funzionalità della piattaforma.";
    opts = {
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
    };

  } else if (tipo === "benvenuto") {
    subject = oggetto_custom || `Benvenuto su SpiaggiaMia — ${stabilimento_nome}`;
    const testoCustom = testo_custom || "Siamo felicissimi di averti con noi per questa stagione! Il tuo account è attivo e puoi già accedere alla piattaforma.";
    const ombrelloneText = ombrellone ? `Il tuo ombrellone è <strong>${ombrellone}</strong>. ` : "";
    opts = {
      headerColor: "linear-gradient(135deg,#E07B54 0%,#f09060 100%)",
      headerEmoji: "☀️ ☂️",
      headerSub: `${stabilimento_nome} ti dà il benvenuto!`,
      nome,
      testoPrincipale: `Benvenuto su <strong>SpiaggiaMia</strong>! ${ombrelloneText}`,
      boxColor: "#FDF0EB",
      boxBorderColor: "#E07B54",
      boxTitoloColor: "#a05030",
      boxTitolo: "🏖️ Inizia subito",
      boxTesto: testoCustom,
      ctaLabel: login_link ? "Accedi a SpiaggiaMia →" : undefined,
      ctaLink: login_link,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Non vediamo l'ora di vederti in spiaggia! 🌊 Per qualsiasi necessità contatta direttamente <strong>${stabilimento_nome}</strong>.`,
    };

  } else if (tipo === "invito") {
    subject = oggetto_custom || `Sei stato invitato su SpiaggiaMia — ${stabilimento_nome}`;
    const testoPrincipaleCustom = testo_custom
      ? testo_custom.replace(/\n/g, "<br>")
      : `<strong>${stabilimento_nome}</strong> ti ha invitato a registrarti su <strong>SpiaggiaMia</strong>, la piattaforma per la gestione degli ombrelloni stagionali.`;
    opts = {
      headerColor: "linear-gradient(135deg,#1B6CA8 0%,#2B8DC8 100%)",
      headerEmoji: "🌊 ☂️",
      headerSub: `${stabilimento_nome} ti invita`,
      nome,
      testoPrincipale: testoPrincipaleCustom,
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
    };

  } else if (tipo === "credito_accreditato") {
    subject = oggetto_custom || `Hai ricevuto ${importo_formatted ?? "dei coin"} — ${stabilimento_nome}`;
    const testoCustom = testo_custom
      ? testo_custom.replace(/\n/g, "<br>")
      : `Abbiamo appena accreditato <strong>${importo_formatted ?? ""}</strong> sul tuo saldo ShareAndFun.${saldo_formatted ? ` Il tuo nuovo saldo è <strong>${saldo_formatted}</strong>.` : ""}${nota ? `<br><br><em>${nota}</em>` : ""}`;
    opts = {
      headerColor: "linear-gradient(135deg,#2EAA6B 0%,#38c97e 100%)",
      headerEmoji: "⭐ 💰",
      headerSub: `Coin accreditati da ${stabilimento_nome}`,
      nome,
      testoPrincipale: `Bella notizia! Il tuo saldo è appena cresciuto.`,
      boxColor: "#E8F8F0",
      boxBorderColor: "#2EAA6B",
      boxTitoloColor: "#1a7a4a",
      boxTitolo: "💰 Coin accreditati",
      boxTesto: testoCustom,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Puoi usare i tuoi coin al bar o al ristorante di <strong>${stabilimento_nome}</strong>. Buona estate! ☀️`,
    };

  } else if (tipo === "credito_ritirato") {
    subject = oggetto_custom || `Hai utilizzato ${importo_formatted ?? "dei coin"} — ${stabilimento_nome}`;
    const testoCustom = testo_custom
      ? testo_custom.replace(/\n/g, "<br>")
      : `Abbiamo registrato l'utilizzo di <strong>${importo_formatted ?? ""}</strong> dal tuo saldo ShareAndFun.${saldo_formatted ? ` Il tuo saldo residuo è <strong>${saldo_formatted}</strong>.` : ""}${nota ? `<br><br><em>${nota}</em>` : ""}`;
    opts = {
      headerColor: "linear-gradient(135deg,#E07B54 0%,#f09060 100%)",
      headerEmoji: "🎉 🧾",
      headerSub: `Coin utilizzati presso ${stabilimento_nome}`,
      nome,
      testoPrincipale: `Hai appena utilizzato parte dei tuoi coin. Ecco il riepilogo.`,
      boxColor: "#FDF0EB",
      boxBorderColor: "#E07B54",
      boxTitoloColor: "#a05030",
      boxTitolo: "🧾 Utilizzo coin",
      boxTesto: testoCustom,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Per qualsiasi dubbio sul saldo contatta direttamente <strong>${stabilimento_nome}</strong>.`,
    };

  } else if (tipo === "chiusura_stagione") {
    subject = oggetto_custom || `La stagione è terminata — ${stabilimento_nome}`;
    const ggDisp = gg_disponibilita ?? 0;
    const ggSub = gg_subaffittato ?? 0;
    const coinIn = coin_ricevuti_formatted ?? "0";
    const coinOut = coin_spesi_formatted ?? "0";
    const riepilogoHtml = `
      <ul style="margin:8px 0 0;padding-left:20px;color:#5A6A7A;font-size:14px;line-height:1.7">
        <li><strong>${ggDisp}</strong> ${ggDisp === 1 ? "giorno" : "giorni"} di disponibilità dichiarata</li>
        <li><strong>${ggSub}</strong> ${ggSub === 1 ? "giorno" : "giorni"} effettivamente sub-affittato</li>
        <li><strong>${coinIn}</strong> ricevuti durante la stagione</li>
        <li><strong>${coinOut}</strong> spesi durante la stagione</li>
      </ul>`;
    const testoCustom = testo_custom
      ? testo_custom.replace(/\n/g, "<br>")
      : `La stagione è ufficialmente conclusa: il tuo account su <strong>SpiaggiaMia</strong> non sarà più attivo fino alla riapertura.<br><br>Grazie di aver fatto parte della stagione! Ecco il tuo riepilogo:`;
    opts = {
      headerColor: "linear-gradient(135deg,#1B6CA8 0%,#2B8DC8 100%)",
      headerEmoji: "🌅 ☂️",
      headerSub: `Fine stagione · ${stabilimento_nome}`,
      nome,
      testoPrincipale: testoCustom,
      boxColor: "#E8F4FD",
      boxBorderColor: "#4A9FD4",
      boxTitoloColor: "#1B6CA8",
      boxTitolo: "📋 Il tuo riepilogo stagionale",
      boxTesto: riepilogoHtml,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Ci vediamo alla prossima stagione! 🌊 Per qualsiasi domanda contatta direttamente <strong>${stabilimento_nome}</strong>.`,
    };

  } else if (tipo === "comunicazione") {
    if (!oggetto_custom || !testo_custom) {
      return new Response(JSON.stringify({ error: "Per il tipo 'comunicazione' oggetto_custom e testo_custom sono obbligatori" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    subject = oggetto_custom;
    const corpoHtml = testo_custom.replace(/\n/g, "<br>");
    opts = {
      headerColor: "linear-gradient(135deg,#1B6CA8 0%,#2B8DC8 100%)",
      headerEmoji: "📣 ☂️",
      headerSub: `Comunicazione da ${stabilimento_nome}`,
      nome,
      testoPrincipale: `Hai ricevuto un messaggio da <strong>${stabilimento_nome}</strong>:`,
      boxColor: "#E8F4FD",
      boxBorderColor: "#4A9FD4",
      boxTitoloColor: "#1B6CA8",
      boxTitolo: oggetto_custom,
      boxTesto: corpoHtml,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Per qualsiasi domanda contatta direttamente <strong>${stabilimento_nome}</strong> ai recapiti qui sopra.`,
    };

  } else {
    return new Response(JSON.stringify({ error: "Tipo non valido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const html = buildEmailHtml(opts);
  const text = buildEmailText(opts);

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY non configurata — email non inviata");
    return new Response(JSON.stringify({ error: "RESEND_API_KEY non configurata sul server" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const unsubscribeMailto = stabilimento_email || "noreply@spiaggiamia.com";
  const payload: Record<string, unknown> = {
    from: buildFromHeader(stabilimento_nome),
    to: email,
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<mailto:${unsubscribeMailto}?subject=Unsubscribe>`,
    },
  };
  if (stabilimento_email && !isFreemail(stabilimento_email)) {
    payload.reply_to = stabilimento_email;
  }

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

  // Audit log: registra l'email inviata. Non blocchiamo la response se fallisce.
  if (stabilimento_id && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const authHeader = req.headers.get("Authorization") || "";
      const logRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/audit_log_write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_KEY,
          // Inoltro il JWT dell'utente quando presente, così auth.uid() risolve
          // all'attore reale. Senza JWT il log viene attribuito a 'sistema'.
          "Authorization": authHeader || `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          p_stabilimento_id: stabilimento_id,
          p_entity_type: "email",
          p_action: "email_sent",
          p_description: `Email "${tipo}" inviata a ${email}`,
          p_metadata: { tipo, to: email, subject, resend_id: data?.id ?? null },
        }),
      });
      if (!logRes.ok) {
        const errTxt = await logRes.text();
        console.error("audit_log_write email failed:", errTxt);
      }
    } catch (e) {
      console.error("audit_log_write email exception:", e);
    }
  }

  return new Response(JSON.stringify({ success: true, id: data.id }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
