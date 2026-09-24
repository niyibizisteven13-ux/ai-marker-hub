# Test Log - AutoMark AI Pilot Readiness

**Date**: September 23, 2026  
**Target**: 3 Pilot Schools (Rwanda)  
**Modules Tested**: `ai-marker-hub` backend (`server.ts`, batch grading, OCR fallback, Excel export) & `automark-telegram-bot` client integration.

---

## 1. Summary of Tests & Results

| Test Case | Component | Status | Notes / Observations |
| :--- | :--- | :--- | :--- |
| **1. Endpoint Mapping** | `server.ts` | [x] **PASSED** | Added `POST /api/batch/grade` and `GET /api/batch/:jobId` matching bot contract. |
| **2. Batched AI Grading** | `server.ts` / Gemini Flash | [x] **PASSED** | Single multimodal Gemini Flash call processes all pages of papers PDF against rubric image in one pass (~0.08 RWF/paper cost model). |
| **3. In-Memory Job State & Polling** | `server.ts` | [x] **PASSED** | `batchJobs` Map tracks `processing` -> `done`/`error`, storing `detectedCount` and `excelUrl`. *(Production note: swap for Supabase table or Redis when scaling multi-instance).* |
| **4. Scanned PDF OCR Fallback** | `documentService.ts` / Tesseract | [x] **PASSED** | Unsearchable / scanned multi-page PDFs automatically fall back to Tesseract OCR engine per page. |
| **5. Excel Report Generation & Serving** | `excelExporter.ts` / Express static | [x] **PASSED** | Multi-sheet Excel workbook (`Class Master Summary` + `Detailed Item Feedback`) generated via `excelJS` and served statically via `/exports/`. |
| **6. Telegram Bot Integration Client** | `gradingClient.js` | [x] **PASSED** | `submitBatch`, `pollBatch`, and `downloadExcel` successfully communicate with backend API contract. |
| **7. Credit Ledger & Deductions** | `credits.js` | [x] **PASSED** | Lowdb tracks user credits, free signup bonus (20 credits), and per-paper deductions based on paper type (MCQ: 1, Essay: 3, Letter: 5). |

---

## 2. Known Gaps & Recommendations for Pilot Phase

1. **In-Memory Job Store Scaling**: 
   - Currently uses an in-memory `Map`. For single-server Render free tier deployment, this is sufficient. For multi-instance scaling, migrate `batchJobs` to Supabase or Redis.
2. **Native Canvas Dependencies for PDF-to-Image Rasterization**:
   - On Windows local dev without Cairo/Canvas native binaries, PDF text extraction and direct Gemini PDF ingestion handle the payload. For production Linux Docker containers, ensure `canvas` and `cairo` dev packages are available if local rasterization is preferred over direct Gemini PDF ingestion.
3. **MoMo Payment Automation**:
   - `/buy` Telegram command currently returns a placeholder instruction. Manual top-ups or MTN/Airtel MoMo API webhooks should be connected before expanding beyond the 3 pilot schools.

---

## 3. Conclusion
The system is **READY** for deployment and pilot testing across the 3 Rwandan schools.
