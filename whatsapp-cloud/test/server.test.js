"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePersonalEvent, extractMessages } = require("../server");

test("accepts a valid personal WhatsApp text event", () => {
  const event = normalizePersonalEvent({
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    source_package: "com.whatsapp",
    direction: "in",
    message_text: "تم تحويل 100 دولار",
    occurred_at: "2026-10-31T00:00:00.000Z"
  });
  assert.ok(event);
  assert.equal(event.direction, "in");
  assert.equal(event.message_text, "تم تحويل 100 دولار");
});

test("accepts WhatsApp and WhatsApp Business packages", () => {
  for (const source_package of ["com.whatsapp", "com.whatsapp.w4b"]) {
    assert.ok(normalizePersonalEvent({
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      source_package,
      direction: "in",
      message_text: "hello"
    }));
  }
  assert.equal(normalizePersonalEvent({
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    source_package: "com.example.other",
    direction: "in",
    message_text: "hello"
  }), null);
});

test("rejects missing text, invalid direction, and oversized text", () => {
  const base = {
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    source_package: "com.whatsapp",
    direction: "in",
    message_text: "hello"
  };
  assert.equal(normalizePersonalEvent({ ...base, message_text: " " }), null);
  assert.equal(normalizePersonalEvent({ ...base, direction: "admin" }), null);
  assert.equal(normalizePersonalEvent({ ...base, message_text: "x".repeat(12001) }), null);
});

test("rejects invalid UUID and invalid timestamp", () => {
  const base = {
    event_id: "not-a-uuid",
    source_package: "com.whatsapp",
    direction: "unknown",
    message_text: "hello"
  };
  assert.equal(normalizePersonalEvent(base), null);
  assert.equal(normalizePersonalEvent({
    ...base,
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    occurred_at: "not-a-date"
  }), null);
});

test("extracts outbound coexistence message echoes with recipient as contact", () => {
  const result = extractMessages({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "smb_message_echoes", value: {
      metadata: { phone_number_id: "123", display_phone_number: "15550001111" },
      message_echoes: [{
        from: "15550001111", to: "15559992222", id: "wamid.echo.1",
        timestamp: "1739321024", type: "text", text: { body: "تم إرسال 250 دينار" }
      }]
    }}]}]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].direction, "out");
  assert.equal(result[0].contact_wa_id, "15559992222");
  assert.equal(result[0].message_text, "تم إرسال 250 دينار");
  assert.equal(result[0].raw_payload, null);
});

test("extracts opted-in history threads and determines message direction", () => {
  const result = extractMessages({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "history", value: {
      metadata: { phone_number_id: "123", display_phone_number: "15550001111" },
      history: [{ threads: [{ id: "15559992222", messages: [
        { from: "15559992222", id: "wamid.hist.in", timestamp: "1739321024", type: "text", text: { body: "وصلت الحوالة" } },
        { from: "15550001111", to: "15559992222", id: "wamid.hist.out", timestamp: "1739321025", type: "text", text: { body: "أرسلت لك" } }
      ]}]}]
    }}]}]
  });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.direction), ["in", "out"]);
  assert.deepEqual(result.map((item) => item.contact_wa_id), ["15559992222", "15559992222"]);
});
