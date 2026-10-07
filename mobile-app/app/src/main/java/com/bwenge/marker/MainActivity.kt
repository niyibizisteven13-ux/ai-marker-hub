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
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader

class MainActivity : AppCompatActivity() {

    private val client = OkHttpClient()
    // 10.0.2.2 points to host localhost in Android Emulator. Adjust for physical device testing if needed.
    private val backendBaseUrl = "http://10.0.2.2:3000"
    private val chatEndpoint = "$backendBaseUrl/api/ai/chat"

    private val phrases = listOf(
        "Connecting to Bwenge AI Gateway...",
        "Routing request to GonkaRouter (GLM-5.3-Flash)...",
        "Analyzing with high-speed intelligence...",
        "Formulating structured response...",
        "Writing output..."
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
            val userPrompt = promptInput.text.toString().trim()
            if (userPrompt.isNotEmpty()) {
                resultText.text = phrases.random()
                composeLoader.visibility = View.VISIBLE
                sendToBwengeBackend(userPrompt, resultText, composeLoader)
            }
        }
    }

    private fun sendToBwengeBackend(prompt: String, resultView: TextView, loader: View) {
        val json = JSONObject().apply {
            put("query", prompt)
            put("provider", "gonkarouter")
        }

        val body = json.toString().toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url(chatEndpoint)
            .post(body)
            .addHeader("Accept", "text/event-stream")
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    loader.visibility = View.GONE
                    resultView.text = "Connection Error: ${e.message}\n(Ensure Bwenge AI backend is running on $backendBaseUrl)"
                }
            }

            override fun onResponse(call: Call, response: Response) {
                if (!response.isSuccessful) {
                    val errBody = response.body?.string() ?: ""
                    runOnUiThread {
                        loader.visibility = View.GONE
                        resultView.text = "API Error (${response.code}): $errBody"
                    }
                    return
                }

                val responseStream = response.body?.byteStream()
                if (responseStream == null) {
                    runOnUiThread {
                        loader.visibility = View.GONE
                        resultView.text = "Error: Received empty response stream from Bwenge AI backend."
                    }
                    return
                }

                val reader = BufferedReader(InputStreamReader(responseStream))
                val accumulatedText = StringBuilder()
                var firstTokenReceived = false

                try {
                    var line: String? = reader.readLine()
                    while (line != null) {
                        val trimmed = line.trim()
                        if (trimmed.startsWith("data:")) {
                            val dataPayload = trimmed.removePrefix("data:").trim()
                            if (dataPayload == "[DONE]") break

                            try {
                                val jsonObj = JSONObject(dataPayload)
                                val type = jsonObj.optString("type")
                                if (type == "text") {
                                    val token = jsonObj.optString("text", "")
                                    if (token.isNotEmpty()) {
                                        accumulatedText.append(token)
                                        if (!firstTokenReceived) {
                                            firstTokenReceived = true
                                            runOnUiThread { loader.visibility = View.GONE }
                                        }
                                        val currentText = accumulatedText.toString()
                                        runOnUiThread {
                                            resultView.text = currentText
                                        }
                                    }
                                } else if (type == "error") {
                                    val err = jsonObj.optString("error", "Unknown backend error")
                                    runOnUiThread {
                                        loader.visibility = View.GONE
                                        resultView.text = "Backend Error: $err"
                                    }
                                }
                            } catch (e: Exception) {
                                // Skip unparseable SSE metadata or commentary
                            }
                        }
                        line = reader.readLine()
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        if (accumulatedText.isEmpty()) {
                            resultView.text = "Stream Read Exception: ${e.message}"
                        }
                    }
                } finally {
                    runOnUiThread {
                        loader.visibility = View.GONE
                        if (accumulatedText.isEmpty() && !firstTokenReceived) {
                            resultView.text = "Bwenge AI completed response with no visible text."
                        }
                    }
                    try { response.close() } catch (ignored: Exception) {}
                }
            }
        })
    }
}
