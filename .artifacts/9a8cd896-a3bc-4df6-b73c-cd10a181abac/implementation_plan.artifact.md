# NVIDIA NIM API Integration in Android Bot & Model Fixes

This implementation plan addresses:
1. **NVIDIA NIM Diagnostic & Fixes**: Why NVIDIA NIM might fail (EOL model strings, missing API key configuration) and updating `AiService.ts` with robust defaults.
2. **NVIDIA NIM Integration in Android Bot**: Updating `TelegramBotEngine.kt` / `GeminiAgent.kt` (or adding an `NvidiaNimAgent.kt` / provider option) so the Android bot can use NVIDIA NIM models (Llama 3.1 / Llama 4) for high-speed reasoning alongside Gemini.

## User Review Required

> [!IMPORTANT]
> This plan adds an `NvidiaNimAgent.kt` to the Android companion app and updates `TelegramBotEngine.kt` with a provider switch (`/provider nvidia` or `/provider gemini`), allowing bot users to use NVIDIA NIM Llama models directly inside Telegram.

---

## Proposed Changes

### [Android Companion App & Backend] mobile-app/ & server/

#### [NEW] [NvidiaNimAgent.kt](file:///C:/Users/niyib/Downloads/ai-marker-hub/mobile-app/app/src/main/java/com/bwenge/marker/NvidiaNimAgent.kt)
- Create NVIDIA NIM API client using OkHttp to call `https://integrate.api.nvidia.com/v1/chat/completions` with Llama models.

#### [MODIFY] [TelegramBotEngine.kt](file:///C:/Users/niyib/Downloads/ai-marker-hub/mobile-app/app/src/main/java/com/bwenge/marker/TelegramBotEngine.kt)
- Add provider toggle (`/nvidia`, `/gemini`) so users can switch between NVIDIA NIM and Gemini in the Telegram bot.

---

## Verification Plan

### Automated Tests
- Gradle build verification for `mobile-app`.

### Manual Verification
- Review updated Kotlin code for correct NVIDIA NIM API request payloads and provider switching.
