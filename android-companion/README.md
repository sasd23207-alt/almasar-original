# Almasar Personal WhatsApp Companion

Native Android companion for the Almasar backend.

## What it does
- Listens only to notifications posted by the standard WhatsApp Android package `com.whatsapp`.
- Captures text exposed by Android notification extras (title, text, big text, and text lines).
- Offers Android Sharesheet text intake for messages manually shared from WhatsApp, marked as outgoing.
- Keeps queued events and the pairing token in Android EncryptedSharedPreferences.
- Sends events to `POST /personal/messages` over HTTPS using WorkManager with network constraints and retry.
- Uses a separate app ID: `ly.almasar.personalbridge`.

## Build
The GitHub Actions workflow builds `app-debug.apk` and publishes it as an artifact.

## Setup
1. Install the APK.
2. Enter the deployed Almasar server HTTPS URL and the one-time pairing code.
3. Pair the device.
4. Open notification access settings and enable **قراءة إشعارات واتساب للمسار**.
5. In WhatsApp, allow message previews in Android notifications. Android may still hide or truncate content.
6. To capture an outgoing message, use WhatsApp's Share action and choose **المسار - ربط واتساب**.
7. Keep the app installed and periodically open it to view queue status.

## Security and limits
- No WhatsApp password, OTP, QR session, accessibility service, or private WhatsApp database access is used.
- The app does not read notifications from other packages.
- Android notification access is broad at the OS permission level; this implementation filters to WhatsApp package notifications before collecting content.
- Notifications can be disabled, hidden, grouped, redacted, or truncated by Android/WhatsApp settings. The app cannot retrieve text that Android does not expose.
- Incoming notifications are marked `in`; text explicitly shared by the user is marked `out`. Ordinary notification access does not reliably reveal every message the phone owner sends, so outgoing capture is an explicit share action.
- Events are only staged by the server. They are not automatically booked as financial transactions.
