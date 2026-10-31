package ly.almasar.personalbridge

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class QueueWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val store = SecureStore(applicationContext)
        val base = store.server()
        val token = store.token()
        if (base.isBlank() || token.isBlank()) return Result.failure()
        return try {
            var sent = 0
            while (sent < 40) {
                val event = store.peek() ?: break
                BridgeApi.send(base, token, event)
                store.removeFirst()
                sent++
            }
            if (store.queueSize() > 0) Result.retry() else Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
