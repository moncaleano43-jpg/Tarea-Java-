// LevaBot con IA — función de Netlify.
// Recibe la pregunta y una foto compacta de los datos de la planta, y responde
// con Claude. La clave (ANTHROPIC_API_KEY) vive aquí, nunca en el HTML.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.LEVABOT_MODEL || "claude-opus-5-5";
const EFFORT = process.env.LEVABOT_EFFORT || "medium";
const TOKEN = process.env.LEVABOT_TOKEN || ""; // opcional: clave compartida con el HTML

const SYSTEM = `Eres LevaBot, el asistente del control de levadura de una cervecería. Hablas con operarios y supervisores de planta, en español de Colombia, directo y sin adornos.

Reglas:
- Responde exactamente lo que se pregunta. La primera frase es la respuesta; después, solo el detalle que haga falta. Sin saludos, sin relleno, sin emojis.
- Usa únicamente los datos de <datos>. Si algo no está ahí, dilo claramente ("no tengo ese dato") y di dónde se registraría. Nunca inventes cifras, fechas ni nombres de levadura.
- Cita siempre FV, lote, colector o levadura concretos, con unidades (°P, Hl, %, h) y fechas en el formato dd/mm hh:mm de los datos.
- Si te piden calcular o comparar, hazlo con los números de <datos> y muestra la cifra final.
- Si la pregunta es ambigua pero hay una lectura razonable, responde con ella y nómbrala en una frase; pregunta solo si no hay forma de acertar.
- Vocabulario: T0 es el momento en que la levadura queda lista para retirar (ideal T0+12 h, máximo T0+24 h). La "alta" es cuando el extracto aparente baja hasta el valor definido por marca. Una cosecha pasa a la generación siguiente.
- No ejecutas acciones (retirar, sembrar, registrar). Si te las piden, indica el paso en la plataforma y qué dato falta.
- Máximo ~120 palabras salvo que se pida un análisis. Usa listas cortas con "-" cuando enumeres.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-levabot-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...cors } });

function armarMensajes(historial, pregunta, contexto) {
  const msgs = [];
  for (const m of Array.isArray(historial) ? historial.slice(-8) : []) {
    const role = m.r === "u" ? "user" : "assistant";
    const text = String(m.t || "").slice(0, 600);
    if (!text) continue;
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n" + text;
    else msgs.push({ role, content: text });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (msgs.length && msgs[msgs.length - 1].role === "user") msgs.pop();
  msgs.push({
    role: "user",
    content: `<datos>\n${JSON.stringify(contexto)}\n</datos>\n\nPregunta: ${pregunta}`,
  });
  return msgs;
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (TOKEN && req.headers.get("x-levabot-token") !== TOKEN) return json({ error: "Clave de acceso incorrecta" }, 401);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Falta ANTHROPIC_API_KEY en el servicio" }, 500);

  let body;
  try {
    const raw = await req.text();
    if (raw.length > 120_000) return json({ error: "Solicitud demasiado grande" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const pregunta = String(body.pregunta || "").trim().slice(0, 800);
  if (!pregunta) return json({ error: "Falta la pregunta" }, 400);

  const client = new Anthropic();
  const params = {
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    output_config: { effort: EFFORT },
    messages: armarMensajes(body.historial, pregunta, body.contexto || {}),
  };
  try {
    let resp;
    try {
      // Si un filtro de seguridad rechaza la pregunta, la API reintenta con otro modelo.
      resp = await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (e) {
      if (e?.status !== 400) throw e;
      resp = await client.messages.create(params); // por si la cuenta aún no tiene ese beta
    }
    if (resp.stop_reason === "refusal") return json({ respuesta: "No puedo responder esa pregunta." });
    const texto = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return json({ respuesta: texto || "No tengo una respuesta para eso." });
  } catch (e) {
    console.error("levabot", e?.status, e?.message);
    return json({ error: e?.status === 429 ? "Demasiadas consultas, intente en un momento" : "No se pudo consultar la IA" }, 502);
  }
};
