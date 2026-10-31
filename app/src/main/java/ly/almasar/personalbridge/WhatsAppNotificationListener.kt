package ly.almasar.personalbridge

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class WhatsAppNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName != "com.whatsapp" || sbn.isOngoing) return
        val extras = sbn.notification.extras ?: return
        val pieces = mutableListOf<String>()
        fun add(value: CharSequence?) {
            val s = value?.toString()?.trim().orEmpty()
            if (s.isNotBlank() && s !in pieces) pieces.add(s)
        }
        add(extras.getCharSequence(Notification.EXTRA_TITLE))
        add(extras.getCharSequence(Notification.EXTRA_BIG_TEXT))
        add(extras.getCharSequence(Notification.EXTRA_TEXT))
        extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.forEach { add(it) }
        if (pieces.isEmpty()) return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val body = pieces.drop(1).joinToString("\n").ifBlank { pieces.joinToString("\n") }
        val event = JSONObject()
            .put("event_id", UUID.randomUUID().toString())
            .put("source_package", "com.whatsapp")
            .put("direction", "in")
            .put("message_text", body.take(12000))
            .put("occurred_at", sbn.postTime)
            .put("conversation", title)
            .put("sender", title)
            .put("capture_method", "android_notification")
            .put("notification_lines", JSONArray(pieces))
        SecureStore(this).enqueue(event.toString())
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = OneTimeWorkRequestBuilder<QueueWorker>().setConstraints(constraints).build()
        WorkManager.getInstance(this).enqueueUniqueWork("almasar-personal-queue", ExistingWorkPolicy.KEEP, request)
    }
}
