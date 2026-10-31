# Almasar Personal WhatsApp Companion

Native Android companion for the Almasar backend.

## What it does
- Listens only to notifications posted by WhatsApp (`com.whatsapp`) or WhatsApp Business (`com.whatsapp.w4b`).
- Captures text exposed by Android notification extras (title, text, big text, and text lines).
- Offers Android Sharesheet text intake with a confirmation step for merchant name and direction (`sent`, `received`, or `unknown`).
- Keeps queued events and the pairing token in Android EncryptedSharedPreferences.
- Sends events to `POST /personal/messages` over HTTPS using WorkManager with network constraints and retry.
- Uses a separate app ID: `ly.almasar.personalbridge`.

## Build
The GitHub Actions workflow builds `app-debug.apk` and publishes it as an artifact.

## Setup
1. Install the APK.
2. Enter the deployed Almasar server HTTPS URL and the one-time pairing code.
3. Pair the device.
4. Open notification access settings and enable **قراءة إشعارات واتساب للمسار**. The app should show its unlinked state if the server rejects an expired token; pair it again.
5. In WhatsApp, allow message previews in Android notifications. Android may still hide or truncate content.
6. To import a message manually, use WhatsApp's Share action and choose **المسار - ربط واتساب**, then confirm the merchant and direction.
7. Keep the app installed and periodically open it to view queue status.

## Security and limits
- No WhatsApp password, OTP, QR session, accessibility service, or private WhatsApp database access is used.
- The app does not read notifications from other packages.
- Android notification access is broad at the OS permission level; this implementation filters to WhatsApp package notifications before collecting content.
- Notifications can be disabled, hidden, grouped, redacted, or truncated by Android/WhatsApp settings. The app cannot retrieve text that Android does not expose.
- Notification direction is `unknown` unless the message itself supplies no reliable direction; shared messages require an explicit direction selection. Ordinary notification access does not reliably reveal every message the phone owner sends, so outgoing capture is an explicit share action.
- The app derives stable event IDs from the notification key, sender, message time, and text to reduce duplicates. MessagingStyle notifications may still repeat or omit items depending on Android/WhatsApp behavior.\n- The queue drops permanent 4xx events, stops and clears expired credentials on 401, and relies on WorkManager exponential retry for transient failures.\n- Events are only staged by the server. They are not automatically booked as financial transactions.
