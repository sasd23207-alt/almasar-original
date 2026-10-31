"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const base = "http://127.0.0.1:" + (process.env.PORT || "10000");
const token = process.env.WEBHOOK_READ_TOKEN || "integration-test-token";
const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function waitForServer(child) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error("Bridge exited before becoming healthy");
    try {
      const response = await fetch(base + "/health");
      if (response.status === 200) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Bridge did not become healthy");
}

test("PostgreSQL ACK clears message bodies and startup retention purges expired content", async () => {
  const messageId = "wamid.integration.ack." + Date.now();
  const personalId = "550e8400-e29b-41d4-a716-446655440099";
  const oldWamid = "wamid.integration.expired." + Date.now();
  let child;
  try {
    // Initialize/migrate PostgreSQL before inserting fixtures; bridge startup then purges expired rows.
    await db.query(fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8"));
    await db.query(
      "INSERT INTO whatsapp_messages (wamid,message_type,message_text,raw_payload,raw_value,received_at) VALUES ($1,'text','ack me','{}','{}',NOW()),($2,'text','expire me','{}','{}',NOW()-INTERVAL '73 hours')",
      [messageId, oldWamid]
    );
    await db.query(
      "INSERT INTO whatsapp_personal_events (event_id,source_package,conversation,sender,direction,message_text,raw_event,received_at) VALUES ($1,'com.whatsapp','chat','sender','in','personal ack','{}',NOW()),($2,'com.whatsapp','chat','sender','in','personal expire','{}',NOW()-INTERVAL '73 hours')",
      [personalId, "550e8400-e29b-41d4-a716-446655440098"]
    );
    await db.query(
      "INSERT INTO whatsapp_status_events (wamid,status,raw_payload,received_at) VALUES ($1,'delivered','{}',NOW()-INTERVAL '2 hours')",
      [oldWamid]
    );
    await db.query(
      "INSERT INTO whatsapp_webhook_receipts (payload_sha256,received_at) VALUES ($1,NOW()-INTERVAL '73 hours')",
      ["integration-expired-" + Date.now()]
    );

    child = spawn(process.execPath, ["server.js"], {
      cwd: __dirname + "/..",
      env: process.env,
      stdio: "ignore"
    });
    await waitForServer(child);

    const headers = { "content-type": "application/json", authorization: "Bearer " + token };
    const ackCloud = await fetch(base + "/messages/ack", {
      method: "POST", headers, body: JSON.stringify({ ids: [messageId] })
    });
    assert.equal(ackCloud.status, 200);
    assert.equal((await ackCloud.json()).acknowledged, 1);

    const ackPersonal = await fetch(base + "/personal/messages/ack", {
      method: "POST", headers, body: JSON.stringify({ ids: [personalId] })
    });
    assert.equal(ackPersonal.status, 200);
    assert.equal((await ackPersonal.json()).acknowledged, 1);

    const rows = await db.query("SELECT wamid,message_text,raw_payload,raw_value FROM whatsapp_messages WHERE wamid=ANY($1::text[])", [[messageId, oldWamid]]);
    const cloudAck = rows.rows.find((row) => row.wamid === messageId);
    const cloudExpired = rows.rows.find((row) => row.wamid === oldWamid);
    assert.equal(cloudAck.message_text, null);
    assert.equal(cloudAck.raw_payload, null);
    assert.equal(cloudAck.raw_value, null);
    assert.equal(cloudExpired.message_text, null);
    assert.equal(cloudExpired.raw_payload, null);

    const personalRows = await db.query(
      "SELECT event_id,message_text,raw_event FROM whatsapp_personal_events WHERE event_id=ANY($1::uuid[])",
      [[personalId, "550e8400-e29b-41d4-a716-446655440098"]]
    );
    const personalAck = personalRows.rows.find((row) => row.event_id === personalId);
    const personalExpired = personalRows.rows.find((row) => row.event_id === "550e8400-e29b-41d4-a716-446655440098");
    assert.equal(personalAck.message_text, null);
    assert.equal(personalAck.raw_event, null);
    assert.equal(personalExpired.message_text, null);
    assert.equal(personalExpired.raw_event, null);

    const statuses = await db.query("SELECT COUNT(*)::int AS count FROM whatsapp_status_events WHERE wamid=$1", [oldWamid]);
    assert.equal(statuses.rows[0].count, 0);
    const receipts = await db.query("SELECT COUNT(*)::int AS count FROM whatsapp_webhook_receipts WHERE payload_sha256 LIKE 'integration-expired-%'");
    assert.equal(receipts.rows[0].count, 0);
  } finally {
    if (child && child.exitCode === null) child.kill("SIGTERM");
    await db.query("DELETE FROM whatsapp_messages WHERE wamid LIKE 'wamid.integration.%'").catch(() => {});
    await db.query("DELETE FROM whatsapp_personal_events WHERE event_id IN ('550e8400-e29b-41d4-a716-446655440099','550e8400-e29b-41d4-a716-446655440098')").catch(() => {});
    await db.query("DELETE FROM whatsapp_status_events WHERE wamid LIKE 'wamid.integration.%'").catch(() => {});
    await db.query("DELETE FROM whatsapp_webhook_receipts WHERE payload_sha256 LIKE 'integration-expired-%'").catch(() => {});
    await db.end();
  }
});
