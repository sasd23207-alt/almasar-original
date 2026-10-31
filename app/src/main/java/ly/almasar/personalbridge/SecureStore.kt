package ly.almasar.personalbridge

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray

class SecureStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "almasar_bridge_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
    @Synchronized fun server(): String = prefs.getString("server", "") ?: ""
    @Synchronized fun token(): String = prefs.getString("token", "") ?: ""
    @Synchronized fun saveCredentials(server: String, token: String) {
        prefs.edit().putString("server", server.trim().trimEnd('/')).putString("token", token).apply()
    }
    @Synchronized fun clearCredentials() { prefs.edit().remove("token").apply() }
    @Synchronized fun enqueue(event: String) {
        val q = JSONArray(prefs.getString("queue", "[]") ?: "[]")
        q.put(event)
        prefs.edit().putString("queue", q.toString()).apply()
    }
    @Synchronized fun peek(): String? {
        val q = JSONArray(prefs.getString("queue", "[]") ?: "[]")
        return if (q.length() == 0) null else q.optString(0, null)
    }
    @Synchronized fun removeFirst() {
        val old = JSONArray(prefs.getString("queue", "[]") ?: "[]")
        val next = JSONArray()
        for (i in 1 until old.length()) next.put(old.getString(i))
        prefs.edit().putString("queue", next.toString()).apply()
    }
    @Synchronized fun queueSize(): Int = JSONArray(prefs.getString("queue", "[]") ?: "[]").length()
}
