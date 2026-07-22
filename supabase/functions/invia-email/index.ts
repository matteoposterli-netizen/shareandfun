import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "SpiaggiaMia <supporto@spiaggiamia.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://spiaggiamia.com";

// Headers CORS uniformi su tutte le response. Necessari su tutte le
// risposte POST: senza, browser da origini come https://www.spiaggiamia.com
// bloccano la fetch nonostante il server risponda 200 OK.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

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
  tipo: "benvenuto" | "attesa" | "approvazione" | "invito" | "credito_accreditato" | "credito_ritirato" | "credito_revocato" | "chiusura_stagione" | "comunicazione" | "ombrellone_disattivato" | "reset_password" | "stabilimento_in_attesa" | "stabilimento_approvato" | "stabilimento_rifiutato" | "conferma_email" | "account_eliminato";
  email?: string;
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
  // Reset password (manager-driven, popolato da richiedi-reset-cliente)
  recovery_link?: string;
  // Verifica email proprietario (popolato da invia-verifica-email): magic link
  // di conferma dell'email di accesso.
  ctaLink?: string;
  // Email di piattaforma verso il proprietario (approvazione stabilimento).
  // Se `email` non e' fornita per i tipi stabilimento_*, l'email destinataria
  // (e il login_link) vengono risolti server-side via getUserById.
  proprietario_id?: string;
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
  // Frase footer: dove finisce davvero una risposta del destinatario.
  // Valorizzata per OGNI tipo prima di costruire html/text (vedi Deno.serve).
  replyNote?: string;
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
  const hasContatti = !!(opts.stabilimento_telefono || opts.stabilimento_email);
  if (opts.stabilimento_telefono) linee.push(`Tel: ${opts.stabilimento_telefono}`);
  if (opts.stabilimento_email) linee.push(`Email: ${opts.stabilimento_email}`);
  linee.push("", stripHtml(opts.replyNote ?? ""));
  if (hasContatti) {
    linee.push(`Oppure contatta direttamente ${opts.stabilimento_nome} ai recapiti qui sopra.`);
  }
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
          <p style="margin:0${contatti ? " 0 6px" : ""};font-size:11px;color:#9AAABB;line-height:1.5">${opts.replyNote ?? ""}</p>
          ${contatti ? `<p style="margin:0;font-size:11px;color:#9AAABB;line-height:1.5">Oppure contatta direttamente <strong>${opts.stabilimento_nome}</strong> ai recapiti qui sopra.</p>` : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Verifica JWT: funzione richiede un utente autenticato (cosi' che il JWT
  // venga validato dal gateway con verify_jwt: true) oppure una chiamata
  // server-to-server con SUPABASE_SERVICE_ROLE_KEY. Stesso pattern di
  // invia-whatsapp. Senza questo check (e con verify_jwt: false), la function
  // sarebbe un open relay che chiunque puo' usare per inviare email tramite
  // Resend impersonando spiaggiamia.com.
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!jwt) {
    return jsonResponse({ error: "Non autorizzato" }, 401);
  }
  if (jwt !== SUPABASE_SERVICE_KEY) {
    const supaClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { error: authErr } = await supaClient.auth.getUser(jwt);
    if (authErr) {
      return jsonResponse({ error: "Non autorizzato" }, 401);
    }
  }

  let body: EmailRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body non valido" }, 400);
  }

  const { tipo, email, nome, cognome = "", stabilimento_id, stabilimento_nome, stabilimento_telefono, stabilimento_email, ombrellone, invite_link, login_link, importo_formatted, saldo_formatted, nota, gg_disponibilita, gg_subaffittato, coin_ricevuti_formatted, coin_spesi_formatted, oggetto_custom, testo_custom, recovery_link, proprietario_id, ctaLink } = body;

  // Tipi "di piattaforma" verso il proprietario: contenuto FISSO (non
  // personalizzabile per stabilimento). Per questi, admin.html non puo'
  // leggere l'email del proprietario (vive solo in auth.users, non in
  // profiles), quindi la risolviamo server-side via service role a partire
  // da proprietario_id. Il login_link (CTA della mail di approvazione) viene
  // costruito dallo stesso indirizzo se non passato dal chiamante.
  const PLATFORM_STAB_TYPES = new Set(["stabilimento_in_attesa", "stabilimento_approvato", "stabilimento_rifiutato"]);
  let recipientEmail = email ?? "";
  let effectiveLoginLink = login_link ?? "";
  if (PLATFORM_STAB_TYPES.has(tipo) && proprietario_id && (!recipientEmail || !effectiveLoginLink)) {
    try {
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: ownerData } = await svc.auth.admin.getUserById(proprietario_id);
      const ownerEmail = ownerData?.user?.email ?? "";
      if (!recipientEmail) recipientEmail = ownerEmail;
      if (!effectiveLoginLink && ownerEmail) {
        effectiveLoginLink = `${APP_URL}/?login=${encodeURIComponent(ownerEmail)}`;
      }
    } catch (e) {
      console.error("getUserById proprietario_id fallita:", e);
    }
  }

  // Il tipo conferma_email (email di piattaforma per la verifica dell'indirizzo
  // di accesso) puo' arrivare senza nome (profilo appena creato / lookup
  // fallito): in quel caso il template ricade su un saluto neutro.
  const nomeRichiesto = tipo !== "conferma_email";
  if (!tipo || !recipientEmail || (nomeRichiesto && !nome)) {
    return jsonResponse({ error: "Parametri mancanti: tipo, email, nome" }, 400);
  }

  // Dove finisce davvero una risposta del destinatario. Il Reply-To viene
  // impostato su stabilimento_email solo se NON e' un freemail (vedi payload
  // piu' sotto): riusiamo la stessa condizione qui per costruire la frase del
  // footer, cosi' che il testo rifletta la verita'. Per i tipi di piattaforma
  // (stabilimento_*, conferma_email) stabilimento_email non e' valorizzata,
  // quindi replyGoesToStabilimento e' false → footer "team di SpiaggiaMia".
  const replyGoesToStabilimento = !!(stabilimento_email && !isFreemail(stabilimento_email));
  const replyNote = replyGoesToStabilimento
    ? `Puoi rispondere direttamente a questa email — ti risponderà <strong>${stabilimento_nome}</strong>.`
    : `Puoi rispondere direttamente a questa email — ti risponderà il team di <strong>SpiaggiaMia</strong>.`;

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
      : `Abbiamo appena accreditato <strong>${importo_formatted ?? ""}</strong> sul tuo saldo SpiaggiaMia.${saldo_formatted ? ` Il tuo nuovo saldo è <strong>${saldo_formatted}</strong>.` : ""}${nota ? `<br><br><em>${nota}</em>` : ""}`;
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
      : `Abbiamo registrato l'utilizzo di <strong>${importo_formatted ?? ""}</strong> dal tuo saldo SpiaggiaMia.${saldo_formatted ? ` Il tuo saldo residuo è <strong>${saldo_formatted}</strong>.` : ""}${nota ? `<br><br><em>${nota}</em>` : ""}`;
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

  } else if (tipo === "credito_revocato") {
    subject = oggetto_custom || `Variazione del tuo saldo — ${stabilimento_nome}`;
    const testoCustom = testo_custom
      ? testo_custom.replace(/\n/g, "<br>")
      : `Ti informiamo che <strong>${importo_formatted ?? "una parte dei tuoi coin"}</strong> è stata revocata dal tuo saldo SpiaggiaMia.${saldo_formatted ? ` Il tuo saldo aggiornato è <strong>${saldo_formatted}</strong>.` : ""}${nota ? `<br><br><em>${nota}</em>` : ""}`;
    opts = {
      headerColor: "linear-gradient(135deg,#5A6A7A 0%,#7A8A9A 100%)",
      headerEmoji: "📋",
      headerSub: `Variazione saldo — ${stabilimento_nome}`,
      nome,
      testoPrincipale: `Ti informiamo di una variazione registrata sul tuo saldo SpiaggiaMia.`,
      boxColor: "#F4F6F8",
      boxBorderColor: "#9AAABB",
      boxTitoloColor: "#5A6A7A",
      boxTitolo: "📋 Coin revocati",
      boxTesto: testoCustom,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Per qualsiasi chiarimento sul saldo contatta direttamente <strong>${stabilimento_nome}</strong>.`,
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
      return jsonResponse({ error: "Per il tipo 'comunicazione' oggetto_custom e testo_custom sono obbligatori" }, 400);
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

  } else if (tipo === "ombrellone_disattivato") {
    subject = oggetto_custom || `Il tuo ombrellone è stato temporaneamente disattivato`;
    const ombrelloneLabel = ombrellone ? `<strong>${ombrellone}</strong>` : "il tuo ombrellone";
    const testoCustom = testo_custom
      ? testo_custom.replace(/\n/g, "<br>")
      : `Il gestore ha temporaneamente disattivato ${ombrelloneLabel}.<br>
         Durante questo periodo non sarà possibile dichiarare disponibilità per il sub-affitto.<br><br>
         Quando l'ombrellone verrà riattivato riceverai un'ulteriore comunicazione.
         Per qualsiasi informazione contatta direttamente lo stabilimento.`;
    opts = {
      headerColor: "linear-gradient(135deg,#E8541A 0%,#F07040 100%)",
      headerEmoji: "⛔ ☂️",
      headerSub: `Comunicazione da ${stabilimento_nome}`,
      nome,
      testoPrincipale: `Ti informiamo di un aggiornamento riguardante il tuo ombrellone presso <strong>${stabilimento_nome}</strong>.`,
      boxColor: "#FFF3F0",
      boxBorderColor: "#F0A090",
      boxTitoloColor: "#C04020",
      boxTitolo: "⛔ Ombrellone temporaneamente non attivo",
      boxTesto: testoCustom,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Per qualsiasi domanda o chiarimento contatta direttamente <strong>${stabilimento_nome}</strong> ai recapiti qui sopra.`,
    };

  } else if (tipo === "reset_password") {
    if (!recovery_link) {
      return jsonResponse({ error: "recovery_link mancante per tipo reset_password" }, 400);
    }
    subject = oggetto_custom || `Reset password — ${stabilimento_nome}`;
    const testoCustom = testo_custom
      ? testo_custom.replace(/\n/g, "<br>")
      : `Il gestore di <strong>${stabilimento_nome}</strong> ha richiesto un reset della tua password.<br>Clicca il pulsante qui sotto per impostare una nuova password. Il link è valido per un'ora.`;
    opts = {
      headerColor: "linear-gradient(135deg,#1B6CA8 0%,#2B8DC8 100%)",
      headerEmoji: "🔑 🌊",
      headerSub: `Reset password — ${stabilimento_nome}`,
      nome,
      testoPrincipale: `È stata richiesta una nuova password per il tuo account su <strong>SpiaggiaMia</strong>.`,
      boxColor: "#E8F4FD",
      boxBorderColor: "#4A9FD4",
      boxTitoloColor: "#1B6CA8",
      boxTitolo: "🔐 Imposta nuova password",
      boxTesto: testoCustom,
      ctaLabel: "Imposta nuova password →",
      ctaLink: recovery_link,
      stabilimento_nome,
      stabilimento_telefono,
      stabilimento_email,
      footer_extra: `Se non hai richiesto questo reset, contatta direttamente <strong>${stabilimento_nome}</strong>. Il link e' valido per un'ora.`,
    };

  } else if (tipo === "stabilimento_in_attesa") {
    // Email di piattaforma (contenuto FISSO): inviata al proprietario subito
    // dopo la creazione dello stabilimento, mentre e' in attesa di verifica.
    subject = `Benvenuto su SpiaggiaMia, ${nome} — la tua richiesta è in revisione`;
    opts = {
      headerColor: "linear-gradient(135deg,#1B6CA8 0%,#2B8DC8 100%)",
      headerEmoji: "🌊 ☂️",
      headerSub: "La tua richiesta è in revisione",
      nome,
      testoPrincipale: `grazie per aver registrato <strong>${stabilimento_nome}</strong> su SpiaggiaMia!<br><br>Il tuo account è stato creato correttamente. Prima di darti accesso alla piattaforma, verifichiamo manualmente ogni nuova iscrizione — un passaggio che facciamo per garantire qualità e sicurezza a tutti gli stabilimenti che usano SpiaggiaMia.`,
      boxColor: "#FDF8E8",
      boxBorderColor: "#F0B429",
      boxTitoloColor: "#856404",
      boxTitolo: "⏳ Richiesta in revisione",
      boxTesto: "Ti contatteremo appena la verifica sarà completata. Non devi fare nulla nel frattempo: riceverai un'altra email non appena il tuo account sarà attivo.",
      stabilimento_nome,
      footer_extra: `Domande? Rispondi pure a questa email.<br><br>A presto,<br>Il team di SpiaggiaMia`,
    };

  } else if (tipo === "stabilimento_approvato") {
    // Email di piattaforma (contenuto FISSO): inviata al click "Approva" in
    // admin.html. CTA verso il login (effectiveLoginLink).
    subject = `🎉 Il tuo account SpiaggiaMia è attivo!`;
    opts = {
      headerColor: "linear-gradient(135deg,#2EAA6B 0%,#38c97e 100%)",
      headerEmoji: "🎉 🌊",
      headerSub: "Account attivo!",
      nome,
      testoPrincipale: `buone notizie: <strong>${stabilimento_nome}</strong> è stato approvato ed è ora attivo su SpiaggiaMia!`,
      boxColor: "#E8F8F0",
      boxBorderColor: "#2EAA6B",
      boxTitoloColor: "#1a7a4a",
      boxTitolo: "🏖️ Inizia subito",
      boxTesto: "Puoi accedere subito e iniziare a configurare la mappa ombrelloni e a gestire i tuoi clienti stagionali.",
      ctaLabel: effectiveLoginLink ? "Accedi a SpiaggiaMia →" : undefined,
      ctaLink: effectiveLoginLink || undefined,
      stabilimento_nome,
      footer_extra: `Se ti serve una mano per iniziare, rispondi pure a questa email.<br><br>Buon lavoro,<br>Il team di SpiaggiaMia`,
    };

  } else if (tipo === "stabilimento_rifiutato") {
    // Email di piattaforma (contenuto FISSO): inviata al click "Rifiuta" in
    // admin.html. Tono neutro/grigio.
    subject = `Aggiornamento sulla tua richiesta SpiaggiaMia`;
    opts = {
      headerColor: "linear-gradient(135deg,#5A6A7A 0%,#7A8A9A 100%)",
      headerEmoji: "📋",
      headerSub: "Aggiornamento sulla tua richiesta",
      nome,
      testoPrincipale: `ti scriviamo in merito alla richiesta di iscrizione per <strong>${stabilimento_nome}</strong>: al momento non siamo in grado di approvarla.`,
      boxColor: "#F4F6F8",
      boxBorderColor: "#9AAABB",
      boxTitoloColor: "#5A6A7A",
      boxTitolo: "📋 Hai bisogno di chiarimenti?",
      boxTesto: "Se vuoi maggiori informazioni, o pensi si tratti di un errore, scrivici rispondendo a questa email: siamo felici di chiarire insieme.",
      stabilimento_nome,
      footer_extra: `Grazie per l'interesse in SpiaggiaMia.<br><br>Il team di SpiaggiaMia`,
    };

  } else if (tipo === "account_eliminato") {
    // Email di piattaforma (contenuto FISSO): inviata quando un admin
    // cancella uno stabilimento dalla tab Tabelle di admin.html tramite la
    // RPC admin_elimina_stabilimento. A quel punto l'account del
    // proprietario è già stato cancellato da auth.users, quindi email/nome
    // arrivano espliciti dal chiamante (non risolvibili via proprietario_id
    // come nei tipi stabilimento_*, perché l'utente non esiste più).
    subject = `Il tuo account SpiaggiaMia è stato rimosso`;
    opts = {
      headerColor: "linear-gradient(135deg,#5A6A7A 0%,#7A8A9A 100%)",
      headerEmoji: "📋",
      headerSub: "Account rimosso",
      nome,
      testoPrincipale: `ti informiamo che il tuo stabilimento <strong>${stabilimento_nome}</strong> e il relativo account su SpiaggiaMia sono stati rimossi dalla piattaforma.`,
      boxColor: "#F4F6F8",
      boxBorderColor: "#9AAABB",
      boxTitoloColor: "#5A6A7A",
      boxTitolo: "📋 Non riconosci questa richiesta?",
      boxTesto: "Se pensi si tratti di un errore, rispondi a questa email: siamo felici di chiarire insieme.",
      stabilimento_nome,
      footer_extra: `Grazie per aver fatto parte di SpiaggiaMia.<br><br>Il team di SpiaggiaMia`,
    };

  } else if (tipo === "conferma_email") {
    // Email di piattaforma (contenuto FISSO): inviata al proprietario appena
    // auto-registrato per verificare la sua email di accesso. Il ctaLink e' un
    // magic link generato da invia-verifica-email. Nessuno stabilimento con
    // email/telefono → footer ricade automaticamente sul "team di SpiaggiaMia".
    subject = `Conferma la tua email per SpiaggiaMia`;
    opts = {
      headerColor: "linear-gradient(135deg,#1B6CA8 0%,#2B8DC8 100%)",
      headerEmoji: "✉️ 🌊",
      headerSub: "Conferma la tua email",
      nome,
      testoPrincipale: `grazie per esserti registrato su <strong>SpiaggiaMia</strong>! Conferma il tuo indirizzo email per continuare con l'attivazione del tuo account.`,
      boxColor: "#E8F4FD",
      boxBorderColor: "#4A9FD4",
      boxTitoloColor: "#1B6CA8",
      boxTitolo: "✉️ Conferma la tua email",
      boxTesto: "Clicca il pulsante qui sotto per confermare che questo indirizzo è tuo. Ti serve un attimo, poi potrai proseguire con la configurazione del tuo stabilimento.",
      ctaLabel: ctaLink ? "Conferma la mia email →" : undefined,
      ctaLink: ctaLink || undefined,
      stabilimento_nome,
      footer_extra: "Se non hai richiesto tu questa registrazione, ignora pure questa email.",
    };

  } else {
    return jsonResponse({ error: "Tipo non valido" }, 400);
  }

  opts.replyNote = replyNote;

  const html = buildEmailHtml(opts);
  const text = buildEmailText(opts);

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY non configurata — email non inviata");
    return jsonResponse({ error: "RESEND_API_KEY non configurata sul server" }, 500);
  }

  const unsubscribeMailto = stabilimento_email || "noreply@spiaggiamia.com";
  const payload: Record<string, unknown> = {
    from: buildFromHeader(stabilimento_nome),
    to: recipientEmail,
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<mailto:${unsubscribeMailto}?subject=Unsubscribe>`,
    },
  };
  if (replyGoesToStabilimento) {
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
    return jsonResponse({ error: err }, 500);
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
          p_description: `Email "${tipo}" inviata a ${recipientEmail}`,
          p_metadata: { tipo, to: recipientEmail, subject, resend_id: data?.id ?? null },
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

  return jsonResponse({ success: true, id: data.id }, 200);
});
