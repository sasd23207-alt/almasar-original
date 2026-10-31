"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePersonalEvent } = require("../server");

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
