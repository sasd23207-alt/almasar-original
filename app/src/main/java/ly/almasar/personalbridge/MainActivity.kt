package ly.almasar.personalbridge

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var store: SecureStore
    private lateinit var server: EditText
    private lateinit var code: EditText
    private lateinit var status: TextView
    private val executor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = SecureStore(this)
        server = findViewById(R.id.serverUrl)
        code = findViewById(R.id.pairingCode)
        status = findViewById(R.id.statusText)
        server.setText(store.server())
        findViewById<Button>(R.id.pairButton).setOnClickListener { pairDevice() }
        findViewById<Button>(R.id.permissionButton).setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        findViewById<Button>(R.id.syncButton).setOnClickListener { scheduleUpload(); refreshStatus("بدأ إرسال الرسائل المحفوظة") }
        findViewById<Button>(R.id.revokeButton).setOnClickListener { revokeDevice() }
        handleShare(intent)
        refreshStatus()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShare(intent)
    }

    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim().orEmpty()
        if (shared.isBlank()) {
            refreshStatus("لم يصل نص للمشاركة")
            return
        }
        val event = JSONObject()
            .put("event_id", UUID.randomUUID().toString())
            .put("source_package", "com.whatsapp")
            .put("direction", "out")
            .put("message_text", shared.take(12000))
            .put("occurred_at", System.currentTimeMillis())
            .put("conversation", "Shared from WhatsApp")
            .put("sender", "Phone owner")
            .put("capture_method", "android_share")
        store.enqueue(event.toString())
        scheduleUpload()
        refreshStatus("تم حفظ النص المشارك وإضافته إلى طابور الإرسال")
    }

    private fun pairDevice() {
        val base = server.text.toString().trim().trimEnd('/')
        val pairingCode = code.text.toString().trim()
        if (!base.startsWith("https://") || pairingCode.isBlank()) {
            refreshStatus("أدخل رابط HTTPS ورمز الربط")
            return
        }
        refreshStatus("جارٍ ربط الجهاز...")
        executor.execute {
            try {
                val token = BridgeApi.pair(base, pairingCode, android.os.Build.MODEL ?: "Android")
                store.saveCredentials(base, token)
                runOnUiThread {
                    code.text.clear()
                    refreshStatus("تم ربط الجهاز بالخادم بنجاح")
                    scheduleUpload()
                }
            } catch (e: Exception) {
                runOnUiThread { refreshStatus("فشل الربط: ${e.message ?: "خطأ غير معروف"}") }
            }
        }
    }

    private fun revokeDevice() {
        val base = store.server()
        val token = store.token()
        if (base.isBlank() || token.isBlank()) {
            store.clearCredentials()
            refreshStatus("لا يوجد جهاز مربوط")
            return
        }
        refreshStatus("جارٍ إلغاء الربط...")
        executor.execute {
            try {
                BridgeApi.revoke(base, token)
                store.clearCredentials()
                runOnUiThread { refreshStatus("تم إرسال طلب إلغاء الربط") }
            } catch (e: Exception) {
                runOnUiThread { refreshStatus("تعذر إلغاء الربط: ${e.message}") }
            }
        }
    }

    private fun scheduleUpload() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = OneTimeWorkRequestBuilder<QueueWorker>().setConstraints(constraints).build()
        WorkManager.getInstance(this).enqueueUniqueWork("almasar-personal-queue", ExistingWorkPolicy.KEEP, request)
    }

    private fun refreshStatus(message: String? = null) {
        val linked = store.token().isNotBlank()
        status.text = message ?: "الحالة: ${if (linked) "مربوط" else "غير مربوط"}\nرسائل بانتظار الإرسال: ${store.queueSize()}"
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }
}
