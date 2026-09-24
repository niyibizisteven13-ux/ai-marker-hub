package com.bwenge.marker

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class NvidiaNimAgent(private val apiKey: String, private val model: String = "meta/llama-3.1-70b-instruct") {
    private val httpClient = OkHttpClient()
    private val baseUrl = "https://integrate.api.nvidia.com/v1/chat/completions"

    suspend fun askAgent(userPrompt: String): String = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("model", model)
                put("messages", JSONArray().apply {
                    put(JSONObject().apply {
                        put("role", "system")
                        put("content", "You are Bwenge AI, powered by NVIDIA NIM Llama.")
                    })
                    put(JSONObject().apply {
                        put("role", "user")
                        put("content", userPrompt)
                    })
                })
                put("temperature", 0.2)
                put("max_tokens", 2048)
                put("stream", false)
            }

            val body = jsonBody.toString().toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url(baseUrl)
                .addHeader("Authorization", "Bearer $apiKey")
                .addHeader("Accept", "application/json")
                .post(body)
                .build()

            val response = httpClient.newCall(request).execute()
            val responseString = response.body?.string()

            if (response.isSuccessful && responseString != null) {
                val jsonRes = JSONObject(responseString)
                val choices = jsonRes.getJSONArray("choices")
                if (choices.length() > 0) {
                    val message = choices.getJSONObject(0).getJSONObject("message")
                    return@withContext message.optString("content", "Empty response from NVIDIA NIM.")
                }
            }
            "NVIDIA NIM Error (${response.code}): $responseString"
        } catch (e: Exception) {
            e.printStackTrace()
            "NVIDIA NIM Exception: ${e.message}"
        }
    }
}
