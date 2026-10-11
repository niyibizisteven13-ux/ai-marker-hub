# Bwenge AI Real Learning Loop - Phase 0 Audit & Implementation Plan

This implementation plan covers the complete audit (Phase 0) and roadmap for transforming Bwenge AI into a closed-loop learning system with instant retrieval, human correction queues, verified answers, dataset curation, offline fine-tuning on rented GPUs, evaluation gates, and voice integration.

## User Review Required

> [!IMPORTANT]
> **Prisma Schema Changes**: Per Non-Negotiable Rule #5, no Prisma schema changes will be executed until this audit and schema diff are reviewed and explicitly approved by you. All migrations will be additive and fully reversible.

> [!IMPORTANT]
> **Fine-Tuning Scope**: Per Rule #1 and Phase 5, real fine-tuning targets open-weights models on rented GPUs (via script + README). The hosted GonkaRouter model (`zai-org/GLM-5.3-Flash`) is never fine-tuned by this system; prompt adapters and retrieval are handled separately.

---

## Part 1: Current Architecture Audit

### 1. Chat Request Flow (`server/routes/agentRoutes.ts`, `server/services/AiService.ts`)
- **Current state**: Chat requests hit `agentRoutes.ts`, which invokes `AiService.sendGonkaChat` or `ContextAwareService`. It optionally retrieves knowledge chunks via `KnowledgeRetrievalService.rankingKnowledgeChunks` based on keyword/text matching in `DocumentChunk`.
- **Gaps**: Lacks automatic verified-answer injection (Phase 3), strict source citations with page/section numbers (Phase 1), and per-domain "answer only from sources" enforcement (Phase 1).

### 2. Document & Attachment Handling (`server/middleware/upload.ts`, `server/routes/files.ts`, `src/services/documentService.ts`)
- **Current state**: Files are uploaded via multer middleware (`server/middleware/upload.ts`), text extracted via `documentService.ts` or basic text splitters. Stored in `FileRecord` and indexed into `Document` and `DocumentChunk`.
- **Gaps**: Limited support for multi-format OCR on scanned PDFs/images and ASR transcripts for audio. No mandatory human review stage before indexing unreviewed OCR/ASR text (Rules #2). Lacks fine-grained metadata (consent flag, license, region, domain, expiry date, status: pending/approved/rejected/retracted).

### 3. Datasets, Examples & Fine-Tune Jobs (`server/routes/adminRoutes.ts`, Prisma models)
- **Current state**: `Dataset`, `DatasetExample`, `FineTuneJob`, `AiModel` exist in schema and `adminRoutes.ts`. Examples are harvested from platform DB records (ApplicationForm, StudioProject, DocumentChunk, UsageEvent) or AI synthesis (`harvestRealExamplesIntoDataset`).
- **Gaps**: Lacks explicit tagging of synthetic examples (Rule #2), robust preference pairs (bad vs corrected answer), stable train/validation/TEST hashing splits, dataset statistics (imbalance warnings, language breakdowns), and export validation rules (minimum size checks).

### 4. UsageEvents & Feedback (`prisma/schema.prisma`)
- **Current state**: `UsageEvent` tracks `userId`, `question`, `model`, `tokensIn`, `tokensOut`, `latencyMs`, `answeredFromKnowledge`.
- **Gaps**: No thumbs up/down feedback collection in chat or review queue for admins/instructors (Phase 2 & 3). No structured correction capture workflow (`errorType`, `correctedAnswer`, `severity`, multi-level approval rules).

---

## Part 2: Proposed Prisma Schema Diff & Additions

To support Phases 1–8 without altering or deleting existing data, we propose adding the following models and fields:

```prisma
// ADDITIONS TO prisma/schema.prisma

// Enhanced DocumentChunk metadata for Phase 1 & 3
model DocumentChunk {
  // ... existing fields ...
  language       String   @default("rw") // rw, fr, en
  domain         String   @default("general") // health, legal, finance, farming, education, general
  region         String   @default("rwanda")
  license        String   @default("proprietary")
  consentGiven   Boolean  @default(false)
  status         String   @default("pending") // pending | approved | rejected | retracted
  expiresAt      DateTime?
}

// Correction and Feedback Queue (Phase 2 & 3)
model CorrectionQueueItem {
  id              String    @id @default(uuid())
  userId          String
  question        String
  aiAnswer        String
  correctedAnswer String
  errorType       String    // wrong_fact | outdated | unnatural_rw | wrong_lang | missing_info | wrong_source | unsafe | tone | other
  severity        String    @default("minor") // minor | major | harmful
  domain          String    @default("general")
  region          String    @default("rwanda")
  sourcesUsed     String?   // JSON stringified source citations
  retrievedChunks String?   // JSON stringified chunks
  modelUsed       String
  promptVersion   Int       @default(1)
  knowledgeVersion Int      @default(1)
  status          String    @default("pending") // pending | approved_1 | approved_2 | rejected | retracted
  approvedBy1     String?
  approvedBy2     String?
  rejectedReason  String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([status, domain])
}

// Verified Answers Store (Phase 3 & 4)
model VerifiedAnswer {
  id              String    @id @default(uuid())
  question        String
  answer          String
  sources         String?   // JSON sources
  language        String    @default("rw")
  domain          String    @default("general")
  version         Int       @default(1)
  status          String    @default("active") // active | conflicted | expired | retracted
  expiresAt       DateTime?
  approvedBy      String
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([domain, language])
}

// Evaluation Benchmark Results (Phase 7)
model EvaluationRun {
  id              String    @id @default(uuid())
  modelName       String
  datasetId       String
  hitRate         Float
  correctness     Float
  naturalness     Float     // 1-5 score
  citationScore   Float
  hallucinationRate Float
  refusalRate     Float
  repeatErrorRate Float
  passedGate      Boolean   @default(false)
  metricsJson     String    // detailed JSON breakdown
  createdAt       DateTime  @default(now())

  @@index([modelName, createdAt])
}
```

---

## Part 3: Verification & Execution Plan

### Verification Strategy
1. **Database Migration Dry-Run**: Test additive Prisma schema migration on a local test database.
2. **API Endpoint Unit Tests**: Verify new correction submission, verified answer retrieval, and dataset curation endpoints.
3. **Admin UI Testing**: Ensure components adhere to styling primitives and handle loading/error/empty states gracefully.

### Phases Execution Roadmap
- **Phase 0**: Audit review & schema approval (Current).
- **Phase 1**: Attached files & OCR/ASR human review pipeline -> Instant Knowledge.
- **Phase 2**: Playground correction workbench & structured error capture.
- **Phase 3**: Live query review queue & role-based approval rules.
- **Phase 4**: Verified answers store & authoritative context injection.
- **Phase 5**: Dataset curation (filters, synthetic badge, stable hash split, JSONL export).
- **Phase 6**: Training job specs, QLoRA/LoRA README for rented GPU.
- **Phase 7**: Evaluation gate & canary deployment.
- **Phase 8**: Voice integration (ASR + TTS with consent).
