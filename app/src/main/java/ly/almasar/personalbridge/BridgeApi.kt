package ly.almasar.personalbridge

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object BridgeApi {
    private fun post(base: String, path: String, body: JSONObject, token: String? = null): JSONObject {
        require(base.startsWith("https://")) { "يجب استخدام عنوان HTTPS آمن" }
        val c = (URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection)
        c.requestMethod = "POST"
        c.connectTimeout = 15000
        c.readTimeout = 20000
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        if (!token.isNullOrBlank()) c.setRequestProperty("Authorization", "Bearer $token")
        c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else c.errorStream
        val response = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
        c.disconnect()
        if (code !in 200..299) throw IllegalStateException("الخادم رفض الطلب ($code): $response")
        return JSONObject(response)
    }
    fun pair(base: String, code: String, deviceName: String): String {
        val result = post(base, "/pair", JSONObject().put("code", code).put("device_name", deviceName))
        return result.optString("token").takeIf { it.isNotBlank() }
            ?: throw IllegalStateException("لم يرجع الخادم رمز الجهاز")
    }
    fun send(base: String, token: String, event: String) {
        post(base, "/personal/messages", JSONObject(event), token)
    }
    fun revoke(base: String, token: String) {
        post(base, "/pair/revoke", JSONObject(), token)
    }
}
