<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy Bwenge AI Marking Studio

This contains everything you need to run your marking app locally.

View your app locally with the development server.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set your AI provider key in the environment file for the backend provider you want to use
3. Run the app:
   `npm run dev`

## Admin Knowledge and RAG

Admin document uploads extract and chunk readable text before marking a document ready. With `GEMINI_API_KEY` configured, document chunks are batch-embedded and retrieval combines semantic and keyword matching; without it, uploads explicitly use keyword retrieval. Existing documents can be embedded through the admin-only `POST /api/admin/documents/:id/reindex-embeddings` endpoint.

The admin AI playground allows up to 120 seconds for provider generation by default. Set `AI_PLAYGROUND_TIMEOUT_MS` to an integer from `30000` to `300000` to override the provider timeout.

Use the admin-only `POST /api/admin/rag/evaluate` endpoint to measure retrieval against known supporting chunk IDs:

```json
{
  "knowledgeBaseId": "knowledge-base-id",
  "limit": 5,
  "cases": [
    {
      "query": "What was GDP growth in 2023?",
      "relevantChunkIds": ["document-chunk-id"]
    }
  ]
}
```

The response reports Recall@K, Precision@K, and mean reciprocal rank. The admin playground abstains when no relevant passage is retrieved and only accepts citations that match retrieved chunk IDs.
