# Bwenge Studio Chat API Specification

This document defines the REST API endpoints supporting the Bwenge Studio chat, document marking, vector retrieval, source citations, feedback corrections, and voice transcription services.

## Endpoints

### 1. Chat Management
- **PATCH `/api/chats/:id`**
  - Payload: `{ title?: string; pinned?: boolean }`
  - Response: Updated chat session object.
- **DELETE `/api/chats/:id`**
  - Deletes the specified chat session.
- **POST `/api/chats/:id/share`**
  - Generates a read-only share link.
  - Response: `{ url: string }`
- **DELETE `/api/chats/:id/share`**
  - Revokes the shared read-only link.

### 2. Message Request & Generation
- **POST `/api/chat`**
  - Payload:
    ```json
    {
      "sessionId": "string",
      "prompt": "string",
      "mode": "auto" | "fast" | "deep",
      "useSources": boolean,
      "answerLanguage": "auto" | "kinyarwanda" | "english" | "french",
      "temporary": boolean
    }
    ```
  - Response (Streaming / JSON):
    Assistant response containing text, citation markers `[1]`, and `sources[]`:
    ```json
    {
      "messageId": "string",
      "text": "...",
      "sources": [
        {
          "id": "src-1",
          "title": "National Statistical Report 2026",
          "publisher": "National Institute of Statistics of Rwanda",
          "year": 2026,
          "page": 14,
          "snippet": "..."
        }
      ]
    }
    ```

### 3. Feedback & Corrections
- **POST `/api/feedback/correction`**
  - Payload:
    ```json
    {
      "chatId": "string",
      "messageId": "string",
      "reason": "string",
      "correction": "string",
      "attachments": []
    }
    ```
  - Response: `{ success: true, message: "Thanks, we'll review this." }`

### 4. Voice Transcription
- **POST `/api/transcribe`**
  - Content-Type: `multipart/form-data`
  - Payload: `audio` (webm / wav blob)
  - Response: `{ text: "string", language: "string" }`
