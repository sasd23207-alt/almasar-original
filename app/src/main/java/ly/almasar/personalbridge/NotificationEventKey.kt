package ly.almasar.personalbridge

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

object NotificationEventKey {
    fun create(notificationKey: String, sender: String, messageTime: Long, body: String): String {
        val stableKey = "$notificationKey|$sender|$messageTime|$body"
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(stableKey.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return UUID.nameUUIDFromBytes(digest.toByteArray(StandardCharsets.UTF_8)).toString()
    }
}
