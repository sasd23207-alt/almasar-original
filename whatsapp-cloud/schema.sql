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

-- Additive migrations: preserve all messages already stored by the first bridge version.
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media JSONB;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS raw_value JSONB;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS merchant_id TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS ledger_result JSONB;

CREATE INDEX IF NOT EXISTS whatsapp_messages_received_at_idx
  ON whatsapp_messages (received_at ASC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_contact_idx
  ON whatsapp_messages (contact_wa_id, message_timestamp DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_processing_idx
  ON whatsapp_messages (processing_status, received_at ASC);

CREATE TABLE IF NOT EXISTS whatsapp_status_events (
  id BIGSERIAL PRIMARY KEY,
  wamid TEXT NOT NULL,
  recipient_id TEXT,
  status TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS whatsapp_status_events_wamid_idx
  ON whatsapp_status_events (wamid, received_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_webhook_receipts (
  payload_sha256 TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
