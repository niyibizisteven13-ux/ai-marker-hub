# Knowledge repositories: file explorer and AI indexing (backend)

**Datasets & Curations** now has a backend for a Windows-Explorer-style repository. Administrators can:
- create repositories;
- upload files or whole folder trees;
- browse nested folders, preview files, and rename, move, copy or delete them;
- search names and contents.

Every supported file is indexed into the **existing** knowledge base, so Bwenge.AI retrieval and chat citations use it.

The work is backend only. No frontend file or dependency changed. The existing dataset, knowledge-base and document endpoints are unchanged.

## What existed and what was reused (inspection)

| Concern | Found in the repository | Used for repositories |
|---|---|---|
| Database | Prisma/Postgres (`prisma/schema.prisma`) with a JSON fallback in `server/db.ts` when no `DATABASE_URL` | New models plus migration `20261022000100_knowledge_repositories`. The fallback gained `skip` and `createMany`, which Prisma already supports. |
| Knowledge index | `KnowledgeBase → Document → DocumentChunk` (embeddings as JSON), `ProcessingJob`, `SpreadsheetSheet/Column/Row` | Each repository links to a knowledge base. Every indexed file becomes one `Document`; its chunks are `DocumentChunk` rows. Spreadsheet rows go into the existing sheet, column and row tables. |
| Retrieval | `retrieveKnowledgeChunks` (hybrid keyword + embeddings, access via `buildKnowledgeAccessWhere`), used by chat `search_knowledge` | Unchanged; repository chunks are found the same way. Repository search reuses `rankHybridKnowledgeChunks`. |
| Embeddings | `EmbeddingService` (Gemini, `GEMINI_API_KEY`) | The same provider. Without it, files are keyword-searchable and marked `pending_embeddings`. |
| Chunking | `splitDocumentIntoChunks` + `RetrievalSetting` (chunk size and overlap) | The same, applied per page, slide or section so locations are kept. |
| File bytes | `FileStore` (opaque ids, owner checks) | Extended with `putFile` (streamed copy with SHA-256), `openStream` (Range), `readRange` and `copyTo`. Repository objects don't expire. |
| Jobs | `FileJobQueue` (persistent, idempotent, retries, recovers after restart) | Job type `knowledge.index`. |
| Parsers | `pdf-parse`, `mammoth`, `exceljs`, `jszip`, `csv-parse`, `sanitize-html`, `sharp`, `tesseract.js` | Extraction and previews. No new dependency. |
| Admin API | `/api/admin/*` behind `requireAuth + requireRole('ADMIN')`, responses `{ success, data }` / `{ success: false, error }` | `/api/admin/knowledge/*` follows the same rules. |
| Chat citations | `services.knowledge.search` in `AiService` mapped `title`/`page`/`url` from fields `DocumentChunk` doesn't have | Fixed in `knowledge/citations.ts`. Citations now carry the path or file name, page, sheet or slide, and a source link. |

Code: `server/services/knowledge/{paths,extract,service,citations}.ts`, `server/routes/knowledgeRepositoryRoutes.ts`, wiring in `server/services/educationRuntime.ts` and `server.ts`.

## Data model (migration `20261022000100_knowledge_repositories`)

- **`KnowledgeRepository`**
  - owner `userId`; optional `organizationId` (shared with its members);
  - `knowledgeBaseId` (created automatically, or an existing accessible one);
  - `settings` (`language`, `domain`, `ocr`, `autoIndex`) and `quotaBytes`.
- **`RepositoryDirectory`**
  - `parentId` (foreign key to itself) and normalised `path`, unique per repository;
  - optional `knowledgeBaseId` override and `aiEnabled`.
  - Empty folders are rows, so they persist.
- **`RepositoryFile`**
  - location: `directoryId`, `name`, `path` (unique per repository);
  - content: `extension`, `mimeType`, `sizeBytes`, `contentHash` (SHA-256), opaque `storageKey`, `version`, uploader;
  - extraction: `extractionStatus` and `extractionMethod`;
  - indexing: `indexStatus`, `indexError`, `indexedAt`, `indexedHash`, `indexedVersion`, `chunkCount`, `documentId` (foreign key to `Document`), `duplicateOfId`, `indexJobId`.
  - Indexes on repository + folder, `contentHash`, `indexStatus` and `storageKey`.

Every chunk's `metadata` holds `repositoryId`, `fileId`, `directoryId`, `path`, `page`, `slide`, `sheet`, `section`, `chunkIndex`, `version`, `contentHash`, `extractionMethod`, `indexedAt` and `sourceUrl`. `pageNumber` and `section` are also filled in.

## Indexing pipeline and states

`uploaded → queued → extracting → chunking → embedding → indexing → indexed`. The other outcomes:

| State | Meaning |
|---|---|
| `pending_embeddings` | Indexed and searchable by keyword, but no embedding provider is configured. Recovered automatically once one is set. |
| `partial_failure` | Some embeddings failed. A retry fills them in without duplicating chunks. |
| `failed` | Extraction failed, with a message for administrators (for example "The PDF could not be read (it may be damaged)"). |
| `unsupported` | Stored and downloadable, not indexed. |
| `excluded` | AI turned off for the file or folder. |
| `duplicate` | Identical bytes are already indexed in the same knowledge base; the original's chunks are reused. |

- **Idempotent:** the file's `Document` row is reused and its chunks replaced. Unchanged content (same hash and version) is skipped.
- **Background:** one job per upload works through files with bounded concurrency (`KNOWLEDGE_INDEX_CONCURRENCY`). It continues in a follow-up job before the queue deadline.
- **Recovery:** files left `uploaded` or `queued` (after a restart or hitting the per-user job limit) are re-queued on startup and every hour.
- **Deletion:** removing a file deletes its document, chunks and table rows. Its bytes are deleted when no other file shares them. Copies that relied on it are indexed themselves.
- **Re-indexing:** changing a file's knowledge base or AI switch, or a folder's, re-indexes only the files affected.

| Format | Extraction | Location kept | Preview |
|---|---|---|---|
| PDF | Text layer per page; pages without text are OCR-ed | page | page text, page count, rendered PNG per page |
| Scanned PDF, PNG/JPEG/WebP/TIFF/GIF | Tesseract OCR (English data bundled) | page | rendered PNG + OCR text |
| DOCX | Mammoth: headings become sections, tables become `a \| b` rows | section | sanitised HTML + text |
| PPTX | Slide text + speaker notes | slide | text per slide |
| XLSX / CSV / TSV | Row chunks that repeat the column names; rows also stored in `SpreadsheetSheet/Column/Row` | sheet, rows | sheet list, headers, paged rows |
| TXT / Markdown / YAML / XML | Text; Markdown is split by headings | section | paged by byte offset |
| JSON | Pretty-printed | – | parsed JSON + text |
| HTML | Text only; scripts and styles dropped | – | sanitised HTML (no scripts, styles, frames, forms, handlers or `javascript:` links) |
| RTF | Control words stripped | – | text |
| ZIP | Not indexed. Listed safely; can be extracted into a folder on request | – | entry list with problems flagged |
| Other | Not indexed | – | metadata + download |

## API contract for the existing frontend

The frontend calls admin endpoints through `authFetch` and `readJson` (`src/api/admin.ts`). These endpoints follow the same pattern: `{ success: true, data }`, or `{ success: false, code, error }` with an HTTP status. Base path: `/api/admin/knowledge`.

| Method & path | Body / query | `data` |
|---|---|---|
| `GET /repositories` | – | `[{ id, name, description, knowledgeBaseId, organizationId, settings, statistics }]` |
| `POST /repositories` | `{ name, description?, organizationId?, knowledgeBaseId?, settings?, quotaBytes? }` | repository (201) |
| `GET /repositories/:id` | – | repository + `statistics` |
| `PATCH /repositories/:id` | `{ name?, description?, settings?, knowledgeBaseId?, quotaBytes? }` | `{ repository, indexJobId }` |
| `DELETE /repositories/:id?confirm=true` | – | `{ deletedFiles }` |
| `GET /repositories/:id/tree` | – | `{ repository, root: {files, bytes}, directories: [{ id, parentId, name, path, files, bytes, aiEnabled, knowledgeBaseId }] }`: all folders, no files (lazy loading) |
| `GET /repositories/:id/contents` · `GET /repositories/:id/directories/:directoryId/contents` (`root` = top level) | `directoryId?`, `sort=name\|type\|size\|modified\|status`, `order`, `limit≤500`, `offset`, `extension`, `status` | `{ directory, breadcrumbs: [{id, name, path}], folders, files, total, offset, limit, hasMore }` |
| `POST /repositories/:id/directories` | `{ name, parentId? }` | folder (201); 409 if the name exists |
| `POST /repositories/:id/uploads` | multipart `files[]`, `directoryId?`, `onConflict=rename\|replace\|skip` | `{ results: [{ path, status, fileId?, reason? }], summary, indexJobId }` |
| `POST /repositories/:id/folder-uploads` | as above + `relativePaths` (JSON array, one per file) and `emptyFolders` (JSON array) | as above |
| `GET /repositories/:id/search` | `q`, `scope=all\|names\|content`, `limit`, `directoryId?` | `{ folders, files, content: [{ fileId, path, name, page, slide, sheet, section, score, excerpt }], method: 'hybrid'\|'keyword' }` |
| `GET /repositories/:id/statistics` | – | `{ files, folders, totalBytes, quotaBytes, byStatus, awaitingIndexing, indexing, indexed, failed, embeddingsAvailable }` |
| `POST /repositories/:id/reindex` | `{ onlyFailed?, force? }` | `{ jobId, files }` (202) |
| `POST /repositories/:id/files/bulk` | `{ action: move\|copy\|delete\|reindex, fileIds[], targetDirectoryId? }` | `{ results: [{ fileId, ok, error? }], indexJobId }` |
| `PATCH /directories/:id` | `{ name?, parentId?, knowledgeBaseId?, aiEnabled? }` | `{ directory, indexJobId }` |
| `DELETE /directories/:id?recursive=true` | – | `{ deletedFiles, deletedFolders }`; 409 `NOT_EMPTY` without `recursive` |
| `GET /files/:id` | – | file: `{ id, name, path, extension, mimeType, sizeBytes, version, extraction: {status, method}, indexing: {status, error, indexedAt, chunks, searchable, jobId, duplicateOf}, … }` |
| `GET /files/:id/preview` | `page`, `sheet`, `offset`, `limit` | `{ kind: text\|markdown\|json\|table\|pdf\|document\|slides\|html\|image\|archive\|unavailable, … }` |
| `GET /files/:id/preview?render=image&page=N` | – | `image/png` (PDF page or image) |
| `GET /files/:id/download` | `inline=1` (PDF, images, plain text only) · `Range` header | file stream: `attachment`, `nosniff`, `CSP: sandbox` |
| `PATCH /files/:id` | `{ name?, directoryId?, knowledgeBaseId?, aiEnabled? }` | `{ file, indexJobId }` |
| `POST /files/:id/copy` | `{ targetDirectoryId?, name? }` | `{ file, indexJobId }` (201) |
| `DELETE /files/:id` | – | `{ deleted }` |
| `POST /files/:id/index` | – | `{ jobId }` (202) |
| `POST /files/:id/extract` | `{ targetDirectoryId?, onConflict? }` | upload-style results for the archive's contents |
| `GET /jobs/:jobId` | – | `{ job: {status, progress}, files: [{ id, path, status, error }], counts }` |

**Cited sources:** `GET /api/knowledge/sources/:fileId` (any signed-in user). Access is allowed to the repository owner, its organisation's members, or anyone when both the document and its knowledge base are globally approved; otherwise the route returns 404. Chat citations link here through `KnowledgePassage.url`.

### Frontend notes

- **Folder upload:** take the files from an `<input type="file" webkitdirectory multiple>`. Append each to `files`, and send `relativePaths = JSON.stringify(files.map(f => f.webkitRelativePath))`. Browsers skip empty folders from an input. Drag-and-drop (`DataTransferItem.webkitGetAsEntry()`) can list them for `emptyFolders`.
- **Explorer view:** `tree` for the folder pane; `contents` (paged with `offset` and `limit`) for the file list; `breadcrumbs` for the path bar. Show `indexing.status` per file and `statistics` per repository.
- **Previews:** render `html` only inside a sandboxed `<iframe srcdoc sandbox>`. Show PDF pages with `<img src=".../preview?render=image&page=N">` and fetch the image with `authFetch`, since it requires authentication.
- **Indexing progress:** poll `GET /jobs/:jobId` or the statistics. Show `indexing.error` and offer `POST /files/:id/index` (retry) or `POST /repositories/:id/reindex { onlyFailed: true }`.

## Bwenge AI: answering users from datasets

A repository is private to its owner and their organisation until an admin turns on **Bwenge AI: all users** in
the repository bar (setting `assistant: true`). From then on, every signed-in user's assistant can use it, on
the web and in Telegram.

**What the assistant can do with a published dataset:**
- `search_knowledge` finds passages across all published datasets. Each passage names the file and its `fileId`.
- `list_datasets` lists the datasets, with their file types and top-level folders.
- `browse_dataset` opens a folder by path, or finds files by name anywhere in the dataset.
- `read_dataset_file` reads any supported file:
  - PDF, Word, PowerPoint, HTML and text, page by page (scans are read through OCR);
  - spreadsheets, CSV and JSON as column headers plus rows.
- `analyze_data` with `{ "type": "repository_file", "id": fileId }` computes statistics over the whole table.
  The assistant reports only the numbers this tool returns.

**Routing:**
- A question that mentions data words (English, Kinyarwanda, French) or the name of a published dataset or one of
  its top-level folders runs on the tool-enabled agent.
- That agent is Claude Haiku when `AI_AGENT_PROVIDER=anthropic`.
- Other chat is unchanged.

**What stays hidden:**
- Folders and files switched off for AI are never shown, read or indexed.
- Turning the switch off removes the dataset from other users' search, browsing, reading, analysis and source links
  at once. The owner keeps access.

**Code:**
- `server/services/knowledge/published.ts`: which datasets are published, and the question detector.
- `assistant*` methods in `knowledge/service.ts`.
- `server/services/ai/tools/datasetTools.ts`.

**Tests:** `tests/dataset_ai.test.ts`.

## Security

- **Paths:** `normalizeRelativePath` rejects absolute paths, drive letters, UNC paths, `..`, `.`, null bytes, control characters and over-deep or over-long paths. ZIP entries are judged by their original names, because `JSZip` silently rewrites `../`.
- **Storage:** bytes are stored under random ids and never under user-supplied names.
- **File types:** content must match the extension (PDF, images, Office, ZIP signatures); text files must not contain binary data; executables are refused.
- **Limits:** per-file size (`KNOWLEDGE_MAX_FILE_BYTES`), files per request, a repository storage quota, and an ingestion rate limit per admin (production).
- **Archives:** entry count, declared total size and compression ratio (above 100:1 is rejected as a likely zip bomb) are checked before extraction. Each entry's real size is enforced while streaming. Symbolic links are skipped.
- **Untrusted content:** previews are sanitised and returned as data. Downloads are attachments with `nosniff` and `CSP: sandbox`. In chat, `search_knowledge` already wraps retrieved passages as untrusted data (`untrusted('KNOWLEDGE PASSAGES', …)`), so instructions inside documents are not followed.
- **Authorization:** checked on every call: admin role, then repository owner or organisation member. Unknown and foreign ids look the same (404). Errors never include storage paths or stack traces.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` (existing) | – | Embedding provider. Without it, indexing completes as keyword-only (`pending_embeddings`). |
| `KNOWLEDGE_MAX_FILE_BYTES` | 100 MB | Per file. |
| `KNOWLEDGE_MAX_FILES_PER_UPLOAD` | 500 | Per request. |
| `KNOWLEDGE_REPO_QUOTA_BYTES` | 5 GB | Default repository quota (override per repository). |
| `KNOWLEDGE_INDEX_CONCURRENCY` | 4 | Files indexed in parallel per job. |
| `KNOWLEDGE_MAX_PARSE_BYTES` / `KNOWLEDGE_PREVIEW_MAX_BYTES` | 60 MB / 50 MB | Larger files are stored and downloadable but not parsed. |
| `KNOWLEDGE_MAX_INDEX_CHARS`, `KNOWLEDGE_MAX_SHEET_ROWS`, `KNOWLEDGE_MAX_TABLE_ROWS`, `KNOWLEDGE_MAX_CHUNKS_PER_FILE` | 2,000,000 / 5000 / 2000 / 20,000 | Indexing bounds; truncation is reported in `indexing.error`. |
| `KNOWLEDGE_ZIP_MAX_ENTRIES`, `KNOWLEDGE_ZIP_MAX_BYTES` | 2000 / 500 MB | Archive extraction. |
| `KNOWLEDGE_OCR` | on | `false` disables Tesseract OCR. |
| `KNOWLEDGE_INGEST_RATE_LIMIT` | 60 per 15 min | Uploads, re-index and extraction per admin (production only). |
| `KNOWLEDGE_TMP_DIR` | OS temp | Where uploads stream before storage. |

Deployment: run `npx prisma migrate deploy` (the existing deploy command already does) to create the three tables. `FILE_STORE_DIR` must be on durable storage.

## Tests

- **`tests/knowledge_repository.test.ts` (9):**
  - path and type validation;
  - repository, nested folders and folder upload preserving the tree, including empty folders;
  - every format indexed, with page, slide or sheet locations and source links, and spreadsheet rows stored;
  - hybrid content search and folder-scoped search;
  - the existing retrieval finding repository chunks, with citation mapping;
  - unchanged uploads add no entries; replaced files re-index in place; copies share the index; deletes clean up chunks and bytes;
  - rename and move cascades, rejecting a move into the folder's own subfolder, recursive delete, sorting, pagination and persistence;
  - `pending_embeddings` → recovery, `partial_failure` → retry, failed or damaged files, unsupported formats, AI-excluded folders;
  - previews for every format, including sanitised HTML;
  - ZIP extraction with traversal entries and a zip bomb refused;
  - owner, organisation and global source access;
  - streamed storage, ranged reads and quota.
- **`tests/knowledge_routes.test.ts`:** the HTTP contract: multipart folder upload (`relativePaths` and `preservePath`), traversal rejection, tree, contents and breadcrumbs, download headers, Range 206, HTML never inline, search, rename, 409/400 guards, source access, 404 for another admin on every endpoint, and the job status.

The tests use synthetic files, a fake embedder and a fake OCR. Database behaviour is exercised through the app's JSON fallback. The migration SQL was generated with `prisma migrate diff` and matches the schema, but it was not applied to a live Postgres here.

## Limitations

- **Chat retrieval permissions in local mode:** chat retrieval depends on the existing Prisma relation filters, which Postgres enforces. The local JSON fallback ignores relation filters (existing behaviour), so only the repository endpoints, which check access in code, are verified by these tests.
- **No chunked or resumable uploads:** uploads stream to disk with per-file limits, and each request is processed as a whole.
- **In-memory parsing:** PDF, DOCX, XLSX and PPTX parsers load the file into memory, bounded by `KNOWLEDGE_MAX_PARSE_BYTES`. ZIP listing and extraction are bounded by `KNOWLEDGE_PREVIEW_MAX_BYTES`.
- **OCR:** Tesseract with English data only. Handwriting OCR through the vision pipeline is not connected to repositories.
- **Spreadsheets:** rows are stored in the existing spreadsheet tables and indexed as row chunks. There is no table-query retrieval yet.
- **Duplicates:** copies of identical content in the same knowledge base are cited through the original. The duplicate check examines up to 50 files with the same hash.
- **Permissions:** only owner or organisation, on top of the admin role. There are no per-folder grants.

## Frontend: the file explorer

Admin console → **Datasets & Curations** → **Knowledge repositories**. The existing prompt-adapter datasets are the
tab's second view.

The explorer is made of:
- `src/components/knowledge/KnowledgeExplorer.tsx`, the main view;
- `src/components/knowledge/FilePreview.tsx`, the preview panel;
- `src/api/knowledge.ts`, the API client.

What it offers:
- **Repositories:**
  - a switcher, plus new, rename, re-index and delete (delete asks you to type the name);
  - storage quota;
  - a "searchable by AI" count, and retry for failed files.
- **Browsing:**
  - a folder tree, breadcrumbs that collapse for deep paths, and list or grid view;
  - sort by name, size, modified or AI status;
  - live indexing status, updated every 3 seconds while files are processed.
- **Uploads:**
  - files, whole folders (keeping their structure), or drag-and-drop of folders, empty ones included;
  - a progress tray with per-file reasons for rejected files;
  - large folders go up in batches of 200.
- **File operations:** new folder, rename, move (folder picker), re-index, delete, and multi-select bulk actions.
- **Previews:**
  - spreadsheet and CSV tables with sheet tabs and paging;
  - PDF pages, with text on demand;
  - Word and HTML in a script-less sandboxed frame;
  - slides, Markdown, text and JSON;
  - images with their OCR text;
  - ZIP listings with "extract here".

  Images and PDF pages are fetched with the bearer token.
- **Search:** file names and contents, showing page, slide or sheet references.
