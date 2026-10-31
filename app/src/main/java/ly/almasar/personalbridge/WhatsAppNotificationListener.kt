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

class WhatsAppNotificationListener : NotificationListenerService() {
    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        requestRebind(android.content.ComponentName(this, WhatsAppNotificationListener::class.java))
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in SUPPORTED_PACKAGES || sbn.isOngoing) return
        val notification = sbn.notification
        if ((notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
        val extras = notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        if (title.matches(Regex("(?i)^\\d+\\s+(new )?messages?$"))) return

        val events = mutableListOf<Triple<String, String, Long>>()
        val messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES)
        if (messages != null) {
            for (item in messages) {
                val bundle = item as? android.os.Bundle ?: continue
                val body = bundle.getCharSequence("text")?.toString()?.trim().orEmpty()
                if (body.isBlank()) continue
                val sender = bundle.getCharSequence("sender")?.toString()?.trim().orEmpty()
                events.add(Triple(sender.ifBlank { title }, body, bundle.getLong("time", sbn.postTime)))
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
            lines.forEach { events.add(Triple(title, it, sbn.postTime)) }
        }
        if (events.isEmpty()) return

        val store = SecureStore(this)
        for ((sender, body, messageTime) in events) {
            val event = JSONObject()
                .put("event_id", NotificationEventKey.create(sbn.key, sender, messageTime, body))
                .put("source_package", sbn.packageName)
                .put("direction", "unknown")
                .put("message_text", body.take(12000))
                .put("occurred_at", messageTime)
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
