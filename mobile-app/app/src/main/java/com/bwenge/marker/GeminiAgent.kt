package com.bwenge.marker

import com.google.ai.client.generativeai.GenerativeModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class GeminiAgent(apiKey: String) {
    private val model: GenerativeModel = GenerativeModel(
        modelName = "gemini-1.5-flash",
        apiKey = apiKey
    )

    suspend fun askAgent(userPrompt: String): String = withContext(Dispatchers.IO) {
        try {
            val response = model.generateContent(userPrompt)
            response.text ?: "Sorry, I received an empty response from Gemini."
        } catch (e: Exception) {
            e.printStackTrace()
            "Sorry, I encountered an error processing that request: ${e.message}"
        }
    }
}
