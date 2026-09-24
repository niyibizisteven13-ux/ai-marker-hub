# Agent Capability Comparison & Gap Analysis

As an AI Assistant integrated into your IDE, I have a unique perspective on the "Bwenge AI" agent built into this project. Below is a comparison of our capabilities and a strategic roadmap for Bwenge's evolution.

## Capability Matrix

| Feature | IDE Assistant (Me) | Bwenge AI (Project) | Gap / Opportunity |
| :--- | :--- | :--- | :--- |
| **Environmental Context** | Full semantic index of local project files and OS integration. | RAG-based vector memory and session-specific logs. | Bwenge lacks a "live view" of its own production environment. |
| **Action Agency** | Direct file system, shell, and build tool control. | JSON-RPC (MCP) based sandbox for limited Python/FS ops. | Bwenge is "sandboxed" for safety, but could benefit from broader "Academic Tools". |
| **Verification Loop** | Can run tests, lint, and analyze files I edit. | Supervisor-Worker loop with strict "YES/NO" validation. | Bwenge's validation is text-based; it needs "Logical Unit Testing". |
| **Reasoning Flow** | Single-agent with complex multi-turn logic. | Hybrid Tree-of-Thought (NVIDIA + Claude) with parallel tasks. | Bwenge's hybrid model is technically superior for high-volume tasks. |
| **Persistence** | Volatile (Session-based within the IDE). | Long-term vector storage ("Bwenge Brain"). | Bwenge has better long-term "institutional memory". |

## Areas for Improvement (The "Bwenge" Roadmap)

### 1. The "Closed-Loop" Feedback Gap
Currently, Bwenge can generate a rubric or a form, but it doesn't "know" if it's actually usable until a human says so.
- **Improvement**: Introduce **Rubric Simulation**. Bwenge should be able to run a "Synthetic Student" through its generated rubric to see if the resulting marks make sense *before* showing it to the teacher.

### 2. Multi-Modal Academic Context
Bwenge is heavily text-focused.
- **Improvement**: Deepen the **Vision-to-Reasoning** pipeline. Instead of just OCR, the agent should perform **Spatial Analysis** (e.g., "The student crossed this out and wrote the correct answer in the top left margin").

### 3. Proactive "Oracle" Insights
Bwenge is currently reactive (waits for a prompt).
- **Improvement**: Implement **Batch Pattern Recognition**. As soon as 50+ papers are uploaded, Bwenge should proactively alert the teacher: *"Hey, 80% of students missed Question 4. There might be a ambiguity in your model answer or a curriculum gap."*

### 4. Direct Pedagogical Integration
- **Improvement**: Link Bwenge directly to **LMS (Learning Management Systems)**. Instead of just "exporting JSON," Bwenge should have a tool to `upload_marks_to_canvas` or `sync_with_google_classroom`.

## Final "Big Plan" Vision

> [!IMPORTANT]
> **The goal is to move Bwenge from a "Copilot" to an "Autonomous Academic Partner".**

The next major architectural shift should be **Multi-Document Synthesis (MDS)**.
Bwenge should be able to look at a **Syllabus**, a **Previous Year's Exam**, and **Current Student Performance** to automatically propose a **Remediation Plan** for the next lesson. This moves the AI from "Marking" to "Teaching Strategy".
