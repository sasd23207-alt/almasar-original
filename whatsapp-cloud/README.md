# Almasar WhatsApp Cloud bridge

This service is the server-side intake layer for the existing Almasar PWA.

## Implemented in this phase

- Meta webhook subscription verification using `META_VERIFY_TOKEN`.
- HMAC-SHA256 verification of `X-Hub-Signature-256` against the raw request body using `META_APP_SECRET`.
- Durable PostgreSQL storage of inbound message events and delivery/read status events.
- Duplicate protection using the WhatsApp message ID and webhook payload digest.
- Preservation of each complete message object and its webhook value in JSONB.
- Extraction of available contact display name, sender ID, timestamp, text/caption, and media metadata.
- Authenticated inbox listing and processing-status update endpoints.
- Authenticated media download proxy using the Meta media ID and access token.

## Personal WhatsApp companion intake (new)

- `POST /personal/messages` accepts events pushed by a separately installed, user-consented Android companion. It requires the paired device's bearer token.
- The server accepts the standard WhatsApp Android package ID (`com.whatsapp`) and WhatsApp Business (`com.whatsapp.w4b`), a UUID event ID, a direction (`in`, `out`, or `unknown`), and non-empty message text up to 12,000 characters.
- Duplicate event IDs are ignored. The original event is retained for audit and the message remains separate from Meta webhook records.
- `GET /personal/messages?limit=100&after=0` retrieves accepted events using an integer cursor.
- This is a secure server intake contract, **not an Android bot**. The repository still needs a native companion app with explicit Android notification access and a tested background delivery queue. Android notifications may omit, truncate, group, or hide message text; the server cannot recover content that Android does not expose.

## Important limits

This bridge receives only new events Meta delivers for the connected WhatsApp Business Account and subscribed webhook fields. It does not sign into or scrape a personal WhatsApp account, does not import personal-account chat history, and does not promise access to every personal or group conversation.

The bridge stores inbound events and the PWA can pair a device and fetch stored messages. PWA sync is performed while the app is open/online; a static PWA cannot run continuously while closed. OCR, audio transcription, and automatic posting of ledger transactions are not yet complete. Incoming messages are staged for the existing extraction/review workflow; do not treat message receipt as a booked financial transaction.

## Required environment variables

Copy `.env.example` for local setup. Configure real secrets only in the hosting provider's secret settings:

- `DATABASE_URL`: persistent PostgreSQL connection string.
- `META_VERIFY_TOKEN`: random webhook verification secret chosen by the app owner.
- `META_APP_SECRET`: Meta app secret used to verify webhook signatures.
- `META_ACCESS_TOKEN`: token authorized for the connected WhatsApp Business Account and media retrieval.
- `META_GRAPH_VERSION`: currently supported Graph API version configured for the Meta app.
- `WEBHOOK_READ_TOKEN`: legacy/admin secret protecting the bridge inbox API.
- `PAIRING_CODE`: one-time code used to pair the first device. The current implementation still consumes one global pairing code; multi-device pairing has not yet been implemented.
- `PWA_ORIGIN`: exact deployed PWA origin, e.g. `https://sasd23207.github.io`. CORS is fail-closed: when unset or when the request Origin differs, browser cross-origin access is not granted.
- `PORT`: supplied by the hosting platform.
- `PGSSL=true`: only if the database endpoint requires trusted TLS.

Do not commit `.env`, access tokens, app secrets, or database credentials.

## Run

Requires Node.js 20+ and PostgreSQL.

```sh
npm install
npm run check
npm start
```

Health endpoint: `GET /health`

Meta webhook callback: `GET|POST /webhook`

## Authenticated API

The PWA uses a per-device token returned by `POST /pair` after supplying `PAIRING_CODE`. The token is stored hashed in PostgreSQL. `POST /pair/revoke` revokes the calling device token. For administrative scripts, `Authorization: Bearer <WEBHOOK_READ_TOKEN>` remains supported.

- `POST /pair` — JSON `{ "code": "one-time-code", "device_name": "phone" }`; returns a per-device token once.
- `POST /pair/revoke` — revoke the currently authenticated device token.
- `GET /messages?status=all&limit=100&after=0` — cursor is an integer string to avoid BIGINT precision loss.
  - Status values: `new`, `processing`, `processed`, `review`, `all`.
  - Returns complete stored message JSON, text, sender/contact information, timestamps, and available media metadata.
- `POST /messages/:wamid/status`
  - JSON: `{"status":"processing|processed|review|new","merchant_id":"optional","ledger_result":{}}`
- `GET /media/:mediaId`
  - Proxies media bytes from Meta after confirming that the media ID belongs to a stored inbound message.

## Deployment

Deploy `whatsapp-cloud` as a Node web service with a persistent PostgreSQL database. The server binds to `0.0.0.0` and listens on the platform-provided `PORT`. A sleeping/free web service or temporary database is not suitable for continuous intake.

## Next phases

1. Deploy the receiver and configure Meta's webhook subscription.
2. Test actual inbound text, long messages, contacts, images, audio, and documents with a connected Business test number.
3. Add per-device pairing and cursor/claim semantics; do not expose a shared server secret in public PWA JavaScript.
4. Connect the PWA to sync messages automatically while preserving its existing IndexedDB ledger.
5. Add OCR/transcription and structured extraction with confidence scoring.
6. Match senders/contacts to merchants and write transactions through the existing accounting rules, with duplicate protection and review for uncertain cases.
7. Run end-to-end tests and verify that merchant statements and currency totals update correctly.
