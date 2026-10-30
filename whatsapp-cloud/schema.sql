CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id BIGSERIAL PRIMARY KEY,
  wamid TEXT NOT NULL UNIQUE,
  phone_number_id TEXT,
  business_display_phone TEXT,
  contact_wa_id TEXT,
  contact_name TEXT,
  message_type TEXT NOT NULL,
  message_text TEXT,
  message_timestamp TIMESTAMPTZ,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_received_at_idx
  ON whatsapp_messages (received_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_contact_idx
  ON whatsapp_messages (contact_wa_id, message_timestamp DESC);
