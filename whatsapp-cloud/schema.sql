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
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'in';
ALTER TABLE whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_direction_check;
ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_direction_check CHECK (direction IN ('in','out'));
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


-- One-time device pairing and per-device credentials.
CREATE TABLE IF NOT EXISTS whatsapp_pairing_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  consumed_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_device_tokens (
  id BIGSERIAL PRIMARY KEY,
  token_sha256 TEXT NOT NULL UNIQUE,
  device_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);


-- User-consented personal WhatsApp companion events. These are notification/share
-- payloads pushed by an Android companion, not events received from Meta.
CREATE TABLE IF NOT EXISTS whatsapp_personal_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  source_package TEXT NOT NULL,
  conversation TEXT,
  sender TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'unknown')),
  message_text TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_status TEXT NOT NULL DEFAULT 'new'
    CHECK (processing_status IN ('new', 'processing', 'review', 'processed')),
  raw_event JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_personal_events_status_idx
  ON whatsapp_personal_events (processing_status, id ASC);
CREATE INDEX IF NOT EXISTS whatsapp_personal_events_time_idx
  ON whatsapp_personal_events (occurred_at DESC);


-- Permit both standard WhatsApp and WhatsApp Business Android package IDs.
ALTER TABLE whatsapp_personal_events
  DROP CONSTRAINT IF EXISTS whatsapp_personal_events_source_package_check;
ALTER TABLE whatsapp_personal_events
  ADD CONSTRAINT whatsapp_personal_events_source_package_check
  CHECK (source_package IN ('com.whatsapp', 'com.whatsapp.w4b'));


-- Privacy retention and multi-device pairing migrations.
ALTER TABLE whatsapp_messages ALTER COLUMN raw_payload DROP NOT NULL;
ALTER TABLE whatsapp_messages ALTER COLUMN raw_value DROP NOT NULL;
ALTER TABLE whatsapp_personal_events ALTER COLUMN message_text DROP NOT NULL;
ALTER TABLE whatsapp_personal_events ALTER COLUMN raw_event DROP NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_pairing_codes (
  id BIGSERIAL PRIMARY KEY,
  code_sha256 TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS whatsapp_pairing_codes_expiry_idx ON whatsapp_pairing_codes (expires_at) WHERE consumed_at IS NULL;
DELETE FROM whatsapp_status_events WHERE received_at < NOW() - INTERVAL '1 hour';
