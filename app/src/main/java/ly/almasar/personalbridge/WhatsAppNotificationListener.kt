package ly.almasar.personalbridge

import android.app.Notification
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

class WhatsAppNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in SUPPORTED_PACKAGES || sbn.isOngoing) return
        val notification = sbn.notification
        if ((notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
        val extras = notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        if (title.matches(Regex("(?i)^\\d+\\s+(new )?messages?$"))) return

        val events = mutableListOf<Pair<String, String>>()
        val messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES)
        if (messages != null) {
            for (item in messages) {
                val bundle = item as? android.os.Bundle ?: continue
                val body = bundle.getCharSequence("text")?.toString()?.trim().orEmpty()
                if (body.isBlank()) continue
                val sender = bundle.getCharSequence("sender")?.toString()?.trim().orEmpty()
                events.add((sender.ifBlank { title }) to body)
            }
        }
        if (events.isEmpty()) {
            val lines = linkedSetOf<String>()
            fun add(value: CharSequence?) {
                val text = value?.toString()?.trim().orEmpty()
                if (text.isNotBlank() && text != title) lines.add(text)
            }
            add(extras.getCharSequence(Notification.EXTRA_BIG_TEXT))
            add(extras.getCharSequence(Notification.EXTRA_TEXT))
            extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.forEach(::add)
            lines.forEach { events.add(title to it) }
        }
        if (events.isEmpty()) return

        val store = SecureStore(this)
        for ((sender, body) in events) {
            val stableKey = "${sbn.key}|$sender|$body"
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(stableKey.toByteArray(StandardCharsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
            val event = JSONObject()
                .put("event_id", UUID.nameUUIDFromBytes(digest.toByteArray(StandardCharsets.UTF_8)).toString())
                .put("source_package", sbn.packageName)
                .put("direction", "unknown")
                .put("message_text", body.take(12000))
                .put("occurred_at", sbn.postTime)
                .put("conversation", title)
                .put("sender", sender)
                .put("capture_method", "android_notification")
            store.enqueue(event.toString())
        }
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = OneTimeWorkRequestBuilder<QueueWorker>().setConstraints(constraints).build()
        WorkManager.getInstance(this).enqueueUniqueWork("almasar-personal-queue", ExistingWorkPolicy.KEEP, request)
    }

    companion object {
        private val SUPPORTED_PACKAGES = setOf("com.whatsapp", "com.whatsapp.w4b")
    }
}
