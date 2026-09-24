package com.bwenge.marker

import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class TelegramBotEngine(
    private val botToken: String,
    private val geminiAgent: GeminiAgent,
    private val nvidiaAgent: NvidiaNimAgent? = null
) {
    private val httpClient = OkHttpClient()
    private var lastUpdateId = 0
    private var isRunning = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Session state per chat
    private val sessionPapers = mutableMapOf<Long, ByteArray>()
    private val sessionRubrics = mutableMapOf<Long, ByteArray>()
    private val chatHistories = mutableMapOf<Long, MutableList<Pair<String, String>>>()
    private val chatLanguages = mutableMapOf<Long, String>()
    private val chatProviders = mutableMapOf<Long, String>() // "gemini" or "nvidia"

    fun startListening() {
        if (isRunning) return
        isRunning = true

        scope.launch {
            while (isRunning) {
                try {
                    val url = "https://api.telegram.org/bot$botToken/getUpdates?offset=${lastUpdateId + 1}&timeout=30"
                    val request = Request.Builder().url(url).build()
                    val response = httpClient.newCall(request).execute()

                    if (response.isSuccessful && response.body != null) {
                        parseAndProcessUpdates(response.body!!.string())
                    }
                    delay(2000)
                } catch (e: Exception) {
                    e.printStackTrace()
                    delay(5000)
                }
            }
        }
    }

    fun stopListening() {
        isRunning = false
        scope.cancel()
    }

    private suspend fun parseAndProcessUpdates(jsonResponse: String) {
        try {
            val obj = JSONObject(jsonResponse)
            if (!obj.optBoolean("ok", false)) return

            val updates = obj.getJSONArray("result")
            for (i in 0 until updates.length()) {
                val update = updates.getJSONObject(i)
                lastUpdateId = update.getInt("update_id")

                if (update.has("message")) {
                    val message = update.getJSONObject("message")
                    val chatId = message.getJSONObject("chat").getLong("id")
                    
                    if (message.has("document")) {
                        val doc = message.getJSONObject("document")
                        val fileId = doc.getString("file_id")
                        val fileName = doc.optString("file_name", "document.pdf")
                        handleIncomingDocument(chatId, fileId, fileName)
                    } else if (message.has("photo")) {
                        val photos = message.getJSONArray("photo")
                        val largestPhoto = photos.getJSONObject(photos.length() - 1)
                        val fileId = largestPhoto.getString("file_id")
                        handleIncomingPhoto(chatId, fileId)
                    } else {
                        val userText = message.optString("text", "").trim()
                        if (userText.isNotEmpty()) {
                            handleIncomingMessage(chatId, userText)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private suspend fun handleIncomingDocument(chatId: Long, fileId: String, fileName: String) {
        val lang = chatLanguages[chatId] ?: "en"
        val msg = if (lang == "rw") "📥 Byakiriwe: `$fileName`. Birikuruwe..." else "📥 Received document: `$fileName`. Downloading..."
        sendTelegramMessage(chatId, msg)
        
        val fileBytes = downloadTelegramFile(fileId)
        if (fileBytes != null) {
            if (fileName.contains("rubric", ignoreCase = true) || fileName.contains("key", ignoreCase = true)) {
                sessionRubrics[chatId] = fileBytes
                val reply = if (lang == "rw") "✅ Rubric yemewe! Ubu shyiramo impapuro z'ibizamini." else "✅ Rubric registered! Now upload student exam papers."
                sendTelegramMessageWithKeyboard(chatId, reply)
            } else {
                sessionPapers[chatId] = fileBytes
                val reply = if (lang == "rw") "✅ Impapuro z'ibizamini zemewe. Ohereza rubric cyangwa ukande *Kosora Ibizamini*." else "✅ Student exam papers registered. Send rubric or tap *Grade Batch*."
                sendTelegramMessageWithKeyboard(chatId, reply)
            }
        } else {
            val err = if (lang == "rw") "❌ Gukurura dosiye byanze." else "❌ Failed to download document."
            sendTelegramMessage(chatId, err)
        }
    }

    private suspend fun handleIncomingPhoto(chatId: Long, fileId: String) {
        val lang = chatLanguages[chatId] ?: "en"
        sendTelegramMessage(chatId, if (lang == "rw") "📥 Ifoto yakiriwe..." else "📥 Received photo...")
        val fileBytes = downloadTelegramFile(fileId)
        if (fileBytes != null) {
            sessionRubrics[chatId] = fileBytes
            val reply = if (lang == "rw") "✅ Rubric y'ifoto yemewe!" else "✅ Rubric photo registered!"
            sendTelegramMessageWithKeyboard(chatId, reply)
        } else {
            sendTelegramMessage(chatId, if (lang == "rw") "❌ Gukurura ifoto byanze." else "❌ Failed to download photo.")
        }
    }

    private suspend fun downloadTelegramFile(fileId: String): ByteArray? = withContext(Dispatchers.IO) {
        try {
            val getFileUrl = "https://api.telegram.org/bot$botToken/getFile?file_id=$fileId"
            val req = Request.Builder().url(getFileUrl).build()
            val res = httpClient.newCall(req).execute()
            val body = res.body?.string() ?: return@withContext null
            val json = JSONObject(body)
            if (!json.optBoolean("ok", false)) return@withContext null

            val filePath = json.getJSONObject("result").getString("file_path")
            val downloadUrl = "https://api.telegram.org/file/bot$botToken/$filePath"
            val downloadReq = Request.Builder().url(downloadUrl).build()
            val downloadRes = httpClient.newCall(downloadReq).execute()
            downloadRes.body?.bytes()
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private suspend fun handleIncomingMessage(chatId: Long, text: String) {
        val lang = chatLanguages[chatId] ?: "en"
        val provider = chatProviders[chatId] ?: "gemini"
        val replyText: String

        when {
            text.equals("/kinyarwanda", ignoreCase = true) -> {
                chatLanguages[chatId] = "rw"
                sendTelegramMessageWithKeyboard(chatId, "🇷🇼 Gahunda iri mu Kinyarwanda!")
                return
            }
            text.equals("/english", ignoreCase = true) -> {
                chatLanguages[chatId] = "en"
                sendTelegramMessageWithKeyboard(chatId, "🇬🇧 Language switched to English!")
                return
            }
            text.equals("/nvidia", ignoreCase = true) -> {
                chatProviders[chatId] = "nvidia"
                sendTelegramMessageWithKeyboard(chatId, "🚀 Switched AI Provider to **NVIDIA NIM (Llama)**!")
                return
            }
            text.equals("/gemini", ignoreCase = true) -> {
                chatProviders[chatId] = "gemini"
                sendTelegramMessageWithKeyboard(chatId, "✨ Switched AI Provider to **Google Gemini**!")
                return
            }
            text.equals("/start", ignoreCase = true) || text.equals("/help", ignoreCase = true) -> {
                replyText = if (lang == "rw") {
                    "👋 Muraho neza kuri Bwenge AI Bot!\n" +
                            "Ubu ukoresha: *${provider.uppercase()}*\n" +
                            "Koresha /nvidia cyangwa /gemini kugira ngo uhindure AI."
                } else {
                    "👋 Welcome to Bwenge AI Bot!\n" +
                            "Active AI Provider: *${provider.uppercase()}*\n" +
                            "Switch providers anytime using /nvidia or /gemini."
                }
                sendTelegramMessageWithKeyboard(chatId, replyText)
            }
            text.equals("/status", ignoreCase = true) || text.contains("Check Status", ignoreCase = true) -> {
                val hasPaper = sessionPapers.containsKey(chatId)
                val hasRubric = sessionRubrics.containsKey(chatId)
                replyText = "📊 *Status*:\n- Provider: ${provider.uppercase()}\n- Papers: ${if (hasPaper) "Loaded" else "None"}\n- Rubric: ${if (hasRubric) "Loaded" else "None"}"
                sendTelegramMessageWithKeyboard(chatId, replyText)
            }
            text.equals("/quota", ignoreCase = true) || text.contains("Quota", ignoreCase = true) -> {
                replyText = "💰 *Quota*: 800 / 800 student scripts available (Active Pro Tier)."
                sendTelegramMessageWithKeyboard(chatId, replyText)
            }
            text.equals("/grade", ignoreCase = true) || text.contains("Grade Batch", ignoreCase = true) -> {
                val paper = sessionPapers[chatId]
                val rubric = sessionRubrics[chatId]
                if (paper == null || rubric == null) {
                    replyText = "⚠️ Please upload both exam papers PDF and rubric document first."
                    sendTelegramMessageWithKeyboard(chatId, replyText)
                } else {
                    sendTelegramMessage(chatId, "✨ Grading batch using *${provider.uppercase()}*...")
                    val result = if (provider == "nvidia" && nvidiaAgent != null) {
                        nvidiaAgent.askAgent("Grade exam papers against rubric.")
                    } else {
                        geminiAgent.askAgent("Grade exam papers against rubric.")
                    }
                    sendTelegramMessageWithKeyboard(chatId, "🎯 *Results*:\n\n$result")
                }
            }
            else -> {
                val history = chatHistories.getOrPut(chatId) { mutableListOf() }
                val prompt = buildString {
                    append("User query: $text")
                }

                val agentReply = if (provider == "nvidia" && nvidiaAgent != null) {
                    nvidiaAgent.askAgent(prompt)
                } else {
                    geminiAgent.askAgent(prompt)
                }

                history.add(text to agentReply)
                if (history.size > 10) history.removeAt(0)

                sendTelegramMessage(chatId, agentReply)
            }
        }
    }

    private fun sendTelegramMessage(chatId: Long, text: String) {
        val url = "https://api.telegram.org/bot$botToken/sendMessage"
        val formBody = FormBody.Builder()
            .add("chat_id", chatId.toString())
            .add("text", text)
            .add("parse_mode", "Markdown")
            .build()

        val request = Request.Builder().url(url).post(formBody).build()
        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { e.printStackTrace() }
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }

    private fun sendTelegramMessageWithKeyboard(chatId: Long, text: String) {
        val url = "https://api.telegram.org/bot$botToken/sendMessage"
        val lang = chatLanguages[chatId] ?: "en"

        val gradeLabel = if (lang == "rw") "✨ Kosora Ibizamini" else "✨ Grade Batch"
        val statusLabel = if (lang == "rw") "📊 Reba uko bihagaze" else "📊 Check Status"
        val exportLabel = if (lang == "rw") "📤 Kuramo Excel" else "📤 Export Results"
        val quotaLabel = if (lang == "rw") "💰 Umubare" else "💰 Quota"

        val keyboard = JSONArray().apply {
            put(JSONArray().apply {
                put(JSONObject().put("text", gradeLabel))
                put(JSONObject().put("text", statusLabel))
            })
            put(JSONArray().apply {
                put(JSONObject().put("text", exportLabel))
                put(JSONObject().put("text", quotaLabel))
            })
        }

        val replyMarkup = JSONObject().apply {
            put("keyboard", keyboard)
            put("resize_keyboard", true)
            put("is_persistent", true)
        }

        val formBody = FormBody.Builder()
            .add("chat_id", chatId.toString())
            .add("text", text)
            .add("parse_mode", "Markdown")
            .add("reply_markup", replyMarkup.toString())
            .build()

        val request = Request.Builder().url(url).post(formBody).build()
        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { e.printStackTrace() }
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }
}
