# Comprehensive Admin Dashboard UX & Section-by-Section Polish Roadmap

## Executive Summary
While the Admin Dashboard (`AdminPage.tsx`) now features a polished glassmorphic aesthetic, quick-action command center, and interactive visual analytics, a truly world-class enterprise console requires consistent polish across **all 16 administration tabs**.

Below is a section-by-section analysis and UX enhancement roadmap to make every tab in the admin dashboard exceptionally professional.

---

## Section-by-Section UX Improvement Roadmap

### 1. Fine-Tuning & Training Studio (`tab === 'finetune'`)
- **Hyperparameter Sliders**: Add interactive sliders for Batch Size, Learning Rate, Epochs, and LoRA Rank $r$ instead of fixed dropdowns.
- **Loss Curve & Metrics Graph**: Render a live ASCII/SVG training loss curve during active training jobs.
- **QLoRA Hardware Estimator**: Display estimated GPU VRAM requirements (e.g. A100 / RTX 4090) based on example count and token length.

### 2. Datasets & Curation (`tab === 'datasets'`)
- **Bulk Selection Toolbar**: Enable multi-select checkboxes for dataset examples so admins can bulk approve, bulk reject, or bulk export.
- **Search & Filter by Status**: Add filter pills (All, Approved, Pending, Rejected) and instant search across instruction/output text.
- **PII Highlight Preview**: Visually highlight detected PII tags (`[EMAIL]`, `[PHONE]`, `[NATIONAL_ID]`) in training examples before export.

### 3. Knowledge Bases & Documents (`tab === 'knowledge' & 'documents'`)
- **Ingestion Progress Bar**: Real-time progress bar and chunk count indicator when uploading or extracting PDF/DOCX/Code files.
- **Chunk Inspector Modal**: Click into any document to inspect its vector embedding dimensions, chunk text, and approval status.

### 4. AI Playground & Evaluation (`tab === 'playground'`)
- **Side-by-Side Model Comparison**: Compare responses from base models vs. dataset-grounded fine-tuned adapters side by side.
- **Citation Inspection Tree**: Expandable evidence citation tree showing exactly which knowledge chunks were retrieved.

### 5. System Logs & Analytics (`tab === 'logs' & 'analytics'`)
- **Log Level Filtering**: Filter system logs by `INFO`, `WARN`, `ERROR`, and search by action type.
- **Date Range Picker**: Filter analytics metrics across 24h, 7d, 30d, or custom date ranges.

### 6. Universal Navigation & Feedback
- **Sidebar Count Badges**: Display live item counts (e.g. total KBs, active models, pending examples) directly on each navigation tab in the sidebar.
- **Loading Skeletons**: Replace plain text loading messages with shimmering skeleton cards across all tabs.
