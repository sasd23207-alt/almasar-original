"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 10000);
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const ACCESS_TOKEN = process.env.WEBHOOK_READ_TOKEN;
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
}) : null;

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
function authorized(req) {
  const supplied = req.headers.authorization || "";
  return ACCESS_TOKEN && supplied === `Bearer ${ACCESS_TOKEN}`;
}
function validSignature(raw, signature) {
  if (!APP_SECRET || !signature || !signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function extractMessages(payload) {
  const out = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      const metadata = value.metadata || {};
      for (const msg of value.messages || []) {
        const contact = contacts.find(c => c.wa_id === msg.from) || contacts[0] || {};
        let text = null;
        if (msg.text && typeof msg.text.body === "string") text = msg.text.body;
        else if (msg.button && msg.button.text) text = msg.button.text;
        else if (msg.interactive) text = msg.interactive.button_reply?.title || msg.interactive.list_reply?.title || null;
        out.push({
          wamid: msg.id,
          phone_number_id: metadata.phone_number_id || null,
          business_display_phone: metadata.display_phone_number || null,
          contact_wa_id: msg.from || null,
          contact_name: contact.profile?.name || null,
          message_type: msg.type || "unknown",
          message_text: text,
          message_timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : null,
          raw_payload: msg
        });
      }
    }
  }
  return out;
}
async function storeMessages(payload) {
  if (!pool) throw new Error("DATABASE_URL_not_configured");
  const messages = extractMessages(payload);
  for (const m of messages) {
    if (!m.wamid) continue;
    await pool.query(
      `INSERT INTO whatsapp_messages
       (wamid, phone_number_id, business_display_phone, contact_wa_id, contact_name,
        message_type, message_text, message_timestamp, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (wamid) DO NOTHING`,
      [m.wamid,m.phone_number_id,m.business_display_phone,m.contact_wa_id,m.contact_name,
       m.message_type,m.message_text,m.message_timestamp,JSON.stringify(m.raw_payload)]
    );
  }
  return messages.length;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, service: "almasar-whatsapp-webhook", databaseConfigured: !!pool });
  }
  if (req.method === "GET" && url.pathname === "/webhook") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
      return send(res, 200, challenge, "text/plain; charset=utf-8");
    }
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }
  if (req.method === "POST" && url.pathname === "/webhook") {
    try {
      const raw = await readBody(req);
      if (!validSignature(raw, req.headers["x-hub-signature-256"])) {
        return send(res, 401, { error: "invalid_signature" });
      }
      const payload = JSON.parse(raw.toString("utf8"));
      if (payload.object !== "whatsapp_business_account") {
        return send(res, 404, { error: "unsupported_object" });
      }
      await storeMessages(payload);
      return send(res, 200, { received: true });
    } catch (error) {
      const status = error.message === "payload_too_large" ? 413 : 500;
      return send(res, status, { error: status === 413 ? "payload_too_large" : "webhook_processing_failed" });
    }
  }
  if (req.method === "GET" && url.pathname === "/messages") {
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
    if (!pool) return send(res, 503, { error: "database_not_configured" });
    try {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
      const result = await pool.query(
        "SELECT wamid, phone_number_id, business_display_phone, contact_wa_id, contact_name, message_type, message_text, message_timestamp, received_at FROM whatsapp_messages ORDER BY received_at DESC LIMIT $1",
        [limit]
      );
      return send(res, 200, { messages: result.rows });
    } catch {
      return send(res, 500, { error: "database_read_failed" });
    }
  }
  return send(res, 404, { error: "not_found" });
});
server.listen(PORT, "0.0.0.0", () => {
  console.log(`WhatsApp webhook listening on 0.0.0.0:${PORT}`);
});
