"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 10000);
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const ACCESS_TOKEN = process.env.WEBHOOK_READ_TOKEN;
const PAIRING_CODE = process.env.PAIRING_CODE;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION;
const PWA_ORIGIN = process.env.PWA_ORIGIN || "";
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;

function send(res, status, body, type = "application/json; charset=utf-8") {
  const headers = { "content-type": type, "cache-control": "no-store", "vary": "Origin" };
  const requestOrigin = res.req && res.req.headers && res.req.headers.origin;
  if (PWA_ORIGIN && requestOrigin === PWA_ORIGIN) {
    headers["access-control-allow-origin"] = PWA_ORIGIN;
    headers["access-control-allow-headers"] = "Authorization, Content-Type";
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
  }
  res.writeHead(status, headers);
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function authorized(req) {
  const supplied = req.headers.authorization || "";
  const token = supplied.startsWith("Bearer ") ? supplied.slice(7) : "";
  if (!token || !pool) return false;
  if (ACCESS_TOKEN && constantTimeEqual(supplied, "Bearer " + ACCESS_TOKEN)) return true;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const found = await pool.query("SELECT 1 FROM whatsapp_device_tokens WHERE token_sha256=$1 AND revoked_at IS NULL", [hash]);
  return found.rowCount > 0;
}
function validSignature(raw, signature, secret = APP_SECRET) {
  if (!secret || !signature || !signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return constantTimeEqual(expected, signature);
}
async function readBody(req, maxBytes = 5 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function normalizePersonalEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const eventId = String(body.event_id || "");
  const sourcePackage = String(body.source_package || "");
  const direction = String(body.direction || "unknown");
  const messageText = typeof body.message_text === "string" ? body.message_text.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) return null;
  if (!["com.whatsapp", "com.whatsapp.w4b"].includes(sourcePackage)) return null;
  if (!["in", "out", "unknown"].includes(direction)) return null;
  if (!messageText || messageText.length > 12000) return null;
  const occurredAt = body.occurred_at ? new Date(body.occurred_at) : null;
  if (occurredAt && !Number.isFinite(occurredAt.getTime())) return null;
  return {
    event_id: eventId,
    source_package: sourcePackage,
    conversation: String(body.conversation || "").slice(0, 200) || null,
    sender: String(body.sender || "").slice(0, 200) || null,
    direction,
    message_text: messageText,
    occurred_at: occurredAt,
    raw_event: body
  };
}

function unixTime(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}
function messageText(msg) {
  const type = msg.type;
  if (type === "text") return msg.text && msg.text.body || null;
  if (type === "button") return msg.button && msg.button.text || null;
  if (type === "interactive") {
    const item = msg.interactive || {};
    return item.button_reply && item.button_reply.title ||
      item.list_reply && item.list_reply.title || null;
  }
  if (["image", "video", "document"].includes(type)) {
    const item = msg[type] || {};
    return item.caption || null;
  }
  if (type === "location") {
    const item = msg.location || {};
    return [item.name, item.address, item.latitude, item.longitude].filter(Boolean).join(" | ") || null;
  }
  if (type === "contacts") return JSON.stringify(msg.contacts || []);
  if (type === "reaction") return msg.reaction && msg.reaction.emoji || null;
  return null;
}
function messageMedia(msg) {
  const type = msg.type;
  if (!["image", "audio", "video", "document", "sticker"].includes(type)) return null;
  const item = msg[type] || {};
  if (!item.id) return null;
  return {
    type: type,
    media_id: item.id,
    mime_type: item.mime_type || null,
    sha256: item.sha256 || null,
    file_size: item.file_size || null,
    filename: item.filename || null,
    caption: item.caption || null,
    voice: !!item.voice
  };
}
function extractMessages(payload) {
  const out = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = new Map((value.contacts || []).map((c) => [
        c.wa_id,
        c.profile && c.profile.name || null
      ]));
      for (const msg of value.messages || []) {
        out.push({
          wamid: msg.id,
          phone_number_id: value.metadata && value.metadata.phone_number_id || null,
          business_display_phone: value.metadata && value.metadata.display_phone_number || null,
          contact_wa_id: msg.from || null,
          contact_name: contacts.get(msg.from) || null,
          message_type: msg.type || "unknown",
          message_text: messageText(msg),
          media: messageMedia(msg),
          message_timestamp: unixTime(msg.timestamp),
          raw_payload: msg,
          raw_value: value
        });
      }
      for (const status of value.statuses || []) {
        out.push({ status_event: status });
      }
    }
  }
  return out;
}
async function storePayload(payload, rawBody) {
  if (!pool) throw new Error("DATABASE_URL_not_configured");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const digest = crypto.createHash("sha256").update(rawBody).digest("hex");
    const receipt = await client.query(
      "INSERT INTO whatsapp_webhook_receipts (payload_sha256) VALUES ($1) ON CONFLICT DO NOTHING RETURNING payload_sha256",
      [digest]
    );
    if (!receipt.rowCount) {
      await client.query("COMMIT");
      return { duplicate: true, inserted: 0 };
    }
    let inserted = 0;
    for (const item of extractMessages(payload)) {
      if (item.status_event) {
        const s = item.status_event;
        await client.query(
          "INSERT INTO whatsapp_status_events (wamid, recipient_id, status, event_timestamp, raw_payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
          [s.id, s.recipient_id || null, s.status || "unknown", unixTime(s.timestamp), JSON.stringify(s)]
        );
        continue;
      }
      if (!item.wamid) continue;
      const result = await client.query(
        "INSERT INTO whatsapp_messages (wamid, phone_number_id, business_display_phone, contact_wa_id, contact_name, message_type, message_text, message_timestamp, media, raw_payload, raw_value) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb) ON CONFLICT (wamid) DO NOTHING",
        [
          item.wamid, item.phone_number_id, item.business_display_phone,
          item.contact_wa_id, item.contact_name, item.message_type, item.message_text,
          item.message_timestamp, JSON.stringify(item.media), JSON.stringify(item.raw_payload),
          JSON.stringify(item.raw_value)
        ]
      );
      inserted += result.rowCount;
    }
    await client.query("COMMIT");
    return { duplicate: false, inserted: inserted };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function readJson(req) {
  const raw = await readBody(req, 256 * 1024);
  return raw.length ? JSON.parse(raw.toString("utf8")) : {};
}
function route(req, res, pathname, method) {
  return req.method === method && new URL(req.url, "http://localhost").pathname === pathname;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "OPTIONS") return send(res, 204, "");
    if (route(req, res, "/health", "GET")) {
      if (!pool) return send(res, 503, { ok: false, database: "not_configured" });
      await pool.query("SELECT 1");
      return send(res, 200, { ok: true, service: "almasar-whatsapp-bridge", database: "connected" });
    }

    if (route(req, res, "/webhook", "GET")) {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && VERIFY_TOKEN && constantTimeEqual(token, VERIFY_TOKEN) && challenge) {
        return send(res, 200, challenge, "text/plain; charset=utf-8");
      }
      return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    }

    if (route(req, res, "/webhook", "POST")) {
      const raw = await readBody(req);
      if (!validSignature(raw, req.headers["x-hub-signature-256"])) {
        return send(res, 401, { error: "invalid_signature" });
      }
      let payload;
      try { payload = JSON.parse(raw.toString("utf8")); }
      catch (_error) { return send(res, 400, { error: "invalid_json" }); }
      if (payload.object !== "whatsapp_business_account") {
        return send(res, 200, { ignored: true });
      }
      await storePayload(payload, raw);
      return send(res, 200, { received: true });
    }

    if (route(req, res, "/pair", "POST")) {
      if (!pool || !PAIRING_CODE) return send(res, 503, { error: "pairing_not_configured" });
      const body = await readJson(req);
      if (!constantTimeEqual(body.code, PAIRING_CODE)) return send(res, 403, { error: "invalid_pairing_code" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const consumed = await client.query(
          "INSERT INTO whatsapp_pairing_state (id, consumed_at) VALUES (1, NOW()) ON CONFLICT (id) DO NOTHING RETURNING id"
        );
        if (!consumed.rowCount) { await client.query("ROLLBACK"); return send(res, 409, { error: "pairing_code_already_used" }); }
        const token = crypto.randomBytes(32).toString("base64url");
        const hash = crypto.createHash("sha256").update(token).digest("hex");
        await client.query("INSERT INTO whatsapp_device_tokens (token_sha256, device_name) VALUES ($1,$2)", [hash, String(body.device_name || "PWA").slice(0,120)]);
        await client.query("COMMIT");
        return send(res, 201, { token, paired: true });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }

    if (req.method === "POST" && url.pathname === "/pair/revoke") {
      if (!(await authorized(req))) return send(res, 401, { error: "unauthorized" });
      const supplied = req.headers.authorization || "";
      const token = supplied.startsWith("Bearer ") ? supplied.slice(7) : "";
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      const revoked = await pool.query(
        "UPDATE whatsapp_device_tokens SET revoked_at=NOW() WHERE token_sha256=$1 AND revoked_at IS NULL RETURNING id",
        [hash]
      );
      if (!revoked.rowCount) return send(res, 404, { error: "device_token_not_found" });
      return send(res, 200, { revoked: true });
    }


    // Ingestion endpoint for an explicitly enabled Android companion.
    // It accepts only user-visible WhatsApp notification text; it does not
    // log in to WhatsApp or read private app storage.
    if (req.method === "POST" && url.pathname === "/personal/messages") {
      if (!(await authorized(req))) return send(res, 401, { error: "unauthorized" });
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      const body = await readJson(req);
      const event = normalizePersonalEvent(body);
      if (!event) return send(res, 400, { error: "invalid_personal_event" });
      const result = await pool.query(
        "INSERT INTO whatsapp_personal_events (event_id, source_package, conversation, sender, direction, message_text, occurred_at, raw_event) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (event_id) DO NOTHING RETURNING id",
        [event.event_id, event.source_package, event.conversation, event.sender, event.direction,
         event.message_text, event.occurred_at, JSON.stringify(event.raw_event)]
      );
      return send(res, result.rowCount ? 201 : 200, { accepted: !!result.rowCount, duplicate: !result.rowCount });
    }

    if (req.method === "GET" && url.pathname === "/personal/messages") {
      if (!(await authorized(req))) return send(res, 401, { error: "unauthorized" });
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      const limit = Math.min(250, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      const after = String(url.searchParams.get("after") || "0");
      if (!/^\d+$/.test(after)) return send(res, 400, { error: "invalid_cursor" });
      const result = await pool.query(
        "SELECT id, event_id, conversation, sender, direction, message_text, occurred_at, received_at, processing_status " +
        "FROM whatsapp_personal_events WHERE id>$1 ORDER BY id ASC LIMIT $2",
        [after, limit]
      );
      const nextCursor = result.rows.length ? String(result.rows[result.rows.length - 1].id) : after;
      return send(res, 200, { messages: result.rows, next_cursor: nextCursor });
    }

    if (req.method === "GET" && url.pathname === "/messages") {
      if (!(await authorized(req))) return send(res, 401, { error: "unauthorized" });
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      const status = url.searchParams.get("status") || "new";
      const allowed = ["new", "processing", "processed", "review", "all"];
      if (!allowed.includes(status)) return send(res, 400, { error: "invalid_status" });
      const cursor = String(url.searchParams.get("after") || "0");
      if (!/^\d+$/.test(cursor)) return send(res, 400, { error: "invalid_cursor" });
      const query = status === "all"
        ? "SELECT id, wamid, phone_number_id, business_display_phone, contact_wa_id, contact_name, message_type, message_text, message_timestamp, media, raw_payload, received_at, processing_status FROM whatsapp_messages WHERE id>$1 ORDER BY id ASC LIMIT $2"
        : "SELECT id, wamid, phone_number_id, business_display_phone, contact_wa_id, contact_name, message_type, message_text, message_timestamp, media, raw_payload, received_at, processing_status FROM whatsapp_messages WHERE processing_status=$1 AND id>$2 ORDER BY id ASC LIMIT $3";
      const values = status === "all" ? [cursor, limit] : [status, cursor, limit];
      const result = await pool.query(query, values);
      const nextCursor = result.rows.length ? String(result.rows[result.rows.length - 1].id) : cursor;
      return send(res, 200, { messages: result.rows, next_cursor: nextCursor });
    }

    const statusMatch = url.pathname.match(/^\/messages\/([^/]+)\/status$/);
    if (req.method === "POST" && statusMatch) {
      if (!(await authorized(req))) return send(res, 401, { error: "unauthorized" });
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      const body = await readJson(req);
      const allowed = ["new", "processing", "processed", "review"];
      if (!allowed.includes(body.status)) return send(res, 400, { error: "invalid_status" });
      const result = await pool.query(
        "UPDATE whatsapp_messages SET processing_status=$2, processed_at=CASE WHEN $2 IN ('processed','review') THEN NOW() ELSE processed_at END, merchant_id=$3, ledger_result=$4::jsonb WHERE wamid=$1 RETURNING wamid, processing_status",
        [decodeURIComponent(statusMatch[1]), body.status, body.merchant_id || null, JSON.stringify(body.ledger_result || null)]
      );
      if (!result.rowCount) return send(res, 404, { error: "message_not_found" });
      return send(res, 200, result.rows[0]);
    }

    if (req.method === "GET" && url.pathname.startsWith("/media/")) {
      if (!(await authorized(req))) return send(res, 401, { error: "unauthorized" });
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      if (!META_ACCESS_TOKEN || !META_GRAPH_VERSION) return send(res, 503, { error: "media_download_not_configured" });
      const mediaId = decodeURIComponent(url.pathname.slice("/media/".length));
      const found = await pool.query(
        "SELECT 1 FROM whatsapp_messages WHERE media->>'media_id'=$1 LIMIT 1",
        [mediaId]
      );
      if (!found.rowCount) return send(res, 404, { error: "media_not_found" });
      const meta = await fetch("https://graph.facebook.com/" + encodeURIComponent(META_GRAPH_VERSION) + "/" + encodeURIComponent(mediaId), {
        headers: { Authorization: "Bearer " + META_ACCESS_TOKEN }
      });
      if (!meta.ok) return send(res, 502, { error: "meta_media_metadata_failed" });
      const info = await meta.json();
      if (!info.url) return send(res, 502, { error: "meta_media_url_missing" });
      const download = await fetch(info.url, { headers: { Authorization: "Bearer " + META_ACCESS_TOKEN } });
      if (!download.ok) return send(res, 502, { error: "meta_media_download_failed" });
      const bytes = Buffer.from(await download.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) return send(res, 413, { error: "media_too_large" });
      return send(res, 200, bytes, download.headers.get("content-type") || "application/octet-stream");
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    const status = error.message === "payload_too_large" ? 413 : 503;
    return send(res, status, { error: status === 413 ? "payload_too_large" : "request_failed" });
  }
});

async function main() {
  if (!pool) throw new Error("DATABASE_URL is required");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  server.listen(PORT, "0.0.0.0", () => {
    console.log("Almasar WhatsApp bridge listening on " + PORT);
  });
}
if (require.main === module) {
  main().catch((error) => {
    console.error("Startup failed:", error.message);
    process.exit(1);
  });
}

module.exports = { validSignature, messageText, messageMedia, extractMessages, normalizePersonalEvent };
