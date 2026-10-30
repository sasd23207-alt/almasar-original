"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { validSignature, messageText, messageMedia, extractMessages } = require("../server");

test("validates a genuine Meta-style HMAC signature", () => {
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const secret = "test-app-secret";
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(validSignature(raw, signature, secret), true);
  assert.equal(validSignature(raw, signature, "wrong-secret"), false);
  assert.equal(validSignature(raw, "sha256=bad", secret), false);
});

test("keeps a long text message intact", () => {
  const longText = "حوالة " + "تفاصيل العملية ".repeat(500);
  assert.equal(messageText({ type: "text", text: { body: longText } }), longText);
});

test("extracts captions and media identifiers without discarding the original payload", () => {
  const image = { type: "image", image: { id: "media-123", mime_type: "image/jpeg", caption: "إيصال حوالة" } };
  assert.deepEqual(messageMedia(image), {
    type: "image",
    media_id: "media-123",
    mime_type: "image/jpeg",
    sha256: null,
    file_size: null,
    filename: null,
    caption: "إيصال حوالة",
    voice: false
  });
  assert.equal(messageText(image), "إيصال حوالة");
});

test("maps sender display name and timestamp from webhook contacts", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "phone-id" },
          contacts: [{ wa_id: "218900000000", profile: { name: "تاجر الاختبار" } }],
          messages: [{
            id: "wamid.test.1",
            from: "218900000000",
            timestamp: "1793383200",
            type: "text",
            text: { body: "تم تحويل 100 دينار" }
          }]
        }
      }]
    }]
  };
  const messages = extractMessages(payload);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].contact_name, "تاجر الاختبار");
  assert.equal(messages[0].message_text, "تم تحويل 100 دينار");
  assert.equal(messages[0].raw_payload.id, "wamid.test.1");
  assert.equal(messages[0].phone_number_id, "phone-id");
});
