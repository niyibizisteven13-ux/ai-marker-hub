package com.bwenge.marker

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.ui.platform.ComposeView
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private val client = OkHttpClient()
    private val ollamaUrl = "http://172.20.25.88:11434/api/chat"
    
    private val phrases = listOf(
        "Figuring out what you need",
        "Thinking through the steps",
        "Working out a plan",
        "Breaking this into steps",
        "Connecting to the model",
        "Reaching out to Claude",
        "Opening the line",
        "Putting the answer together",
        "Writing this out"
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val promptInput = findViewById<EditText>(R.id.promptInput)
        val sendButton = findViewById<Button>(R.id.sendButton)
        val resultText = findViewById<TextView>(R.id.resultText)
        val composeLoader = findViewById<ComposeView>(R.id.composeLoader)

        composeLoader.setContent {
            BwengeLoader(isOverlay = false)
        }

        sendButton.setOnClickListener {
            val userPrompt = promptInput.text.toString()
            if (userPrompt.isNotEmpty()) {
                resultText.text = phrases.random()
                composeLoader.visibility = View.VISIBLE
                sendToOllama(userPrompt, resultText, composeLoader)
            }
        }

        // Initialize Telegram Bot & Gemini Agent Companion Engine (Optional)
        // val botToken = "YOUR_BOT_TOKEN"
        // val geminiApiKey = "YOUR_GEMINI_API_KEY"
        // if (botToken != "YOUR_BOT_TOKEN" && geminiApiKey != "YOUR_GEMINI_API_KEY") {
        //     val geminiAgent = GeminiAgent(geminiApiKey)
        //     val botEngine = TelegramBotEngine(botToken, geminiAgent)
        //     botEngine.startListening()
        // }
    }

    private fun sendToOllama(prompt: String, resultView: TextView, loader: View) {
        val json = JSONObject().apply {
            put("model", "bwenge-agent")
            put("messages", JSONArray().apply {
                put(JSONObject().apply {
                    put("role", "user")
                    put("content", prompt)
                })
            })
            put("stream", false)
        }

        val body = json.toString().toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url(ollamaUrl)
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    loader.visibility = View.GONE
                    resultView.text = "Error: ${e.message}"
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyString = response.body?.string()
                runOnUiThread {
                    loader.visibility = View.GONE
                    if (response.isSuccessful && bodyString != null) {
                        try {
                            val jsonRes = JSONObject(bodyString)
                            val message = jsonRes.getJSONObject("message")
                            val content = message.getString("content")
                            resultView.text = content
                        } catch (e: Exception) {
                            resultView.text = "Parse Error: ${e.message}\nRaw: $bodyString"
                        }
                    } else {
                        resultView.text = "API Error: ${response.code}\n$bodyString"
                    }
                }
            }
        })
    }
}
