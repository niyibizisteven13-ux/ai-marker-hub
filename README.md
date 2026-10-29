<div align="center">

<img src="docs/assets/bwenge-banner.png" alt="Bwenge AI: your education, research and data companion" width="100%" />

# Bwenge.space: NISR 2026 Big Data Hackathon

**Making published statistics accessible, interactive and ready for AI, without downloading a single file.**

[Live app: www.bwenge.space](https://www.bwenge.space) · [Demo video](https://youtu.be/n24wdixVfFU) · [Telegram bot](https://t.me/Bwengebot) · [Documentation](docs/)

*Submission to the NISR 2026 Big Data Hackathon*

</div>

---

## Demo video

[![Bwenge.space: NISR Big Data Hackathon demo (click to watch on YouTube)](https://img.youtube.com/vi/n24wdixVfFU/maxresdefault.jpg)](https://youtu.be/n24wdixVfFU)

**Watch:** https://youtu.be/n24wdixVfFU (under 3 minutes, screen recording of the web app)

## Submission at a glance

| NISR requirement | Where to find it |
|---|---|
| Deployed app, publicly accessible | **https://www.bwenge.space** |
| Login for judges | Sign in with Google, or with any email address (a one-time code is sent). No password or sample account is needed. |
| README: data used, what it communicates, how to interact | This file: [Data](#data), [What it communicates](#what-it-communicates), [How to use it](#how-to-use-it) |
| Script(s) with the code, runs on any machine | [`server.ts`](server.ts), [`server/`](server/), [`src/`](src/) and [Run it](#run-it) |
| Demo video (3 minutes maximum) | [YouTube](https://youtu.be/n24wdixVfFU) and [`demo/`](demo/) |
| Data and a link to the data | [`data/`](data/) and [Data](#data); the datasets are too large for GitHub, so links are given |
| Eligibility documents (both members) | [`student_cards/`](student_cards/) |

---

## The challenge

AI tools are good at summaries, but working with a real, detailed dataset is still hard. A user has to find the
file, download it, clean it, load it into a tool and only then ask a question. Every person repeats the same work,
and large files are difficult to download, process and share.

Meanwhile, institutions such as the **National Institute of Statistics of Rwanda (NISR)** publish valuable datasets
that researchers, students, developers and decision makers need to explore and use.

**This is the challenge Bwenge.space addresses.**

## Our solution: a shared, interactive data layer

Instead of every user downloading and processing the same dataset, the dataset is added **once** to Bwenge.space.
From then on, anyone can explore it and ask questions about it in plain language, on the web or in Telegram.

1. **Add once.** An administrator uploads a dataset or a whole folder (CSV, Excel, PDF reports, Word, text) into a
   dataset repository. Bwenge indexes every file: text, tables, sheets and columns.
2. **Publish.** One switch makes the repository available to all users in the **Public library** and to the AI.
3. **Explore and ask.** Users browse folders and files, preview them, and ask questions such as *"What does this
   dataset say about unemployment by district?"*. The AI reads the actual files and answers with the source file,
   page or sheet cited.
4. **Analyse.** Charts, tables, HTML reports and Excel files are produced in the chat. All numbers are computed by
   code from the data, never estimated by the AI.

We are not replacing the institutions that produce data. Bwenge.space **complements** existing publication systems
such as the NISR microdata portal, by adding a way for people and AI-enabled applications to interact with the data
NISR already publishes.

## Why it matters

- **Less duplicated work:** a dataset is processed once instead of once per user.
- **Easier discovery:** datasets can be browsed, searched and questioned without technical tools.
- **Trustworthy answers:** every figure comes with its source, period and unit, and is computed from the file.
- **Ready for AI:** the same indexed data serves the chat, the Telegram bot and future applications through the API.

## Data

| Source | How it is used |
|---|---|
| **NISR public datasets and reports** ([microdata portal](https://microdata.statistics.gov.rw/index.php/catalog), [statistics.gov.rw](https://www.statistics.gov.rw)) | Uploaded into a dataset repository and published in the Public library. Indexed and cited by source, period and unit when answering statistics questions. See [`data/nisr/README.md`](data/nisr/README.md) for how a dataset is added and checked. |
| **Survey responses collected with Bwenge forms** | Stored with variable names, measurement levels and the form version they answered. Exported as CSV or Excel with a codebook. |
| **Exam scripts uploaded by teachers** | Private to the teacher. Marks are kept with the reason for each mark, and nothing is released without the teacher. |

**Data files and links.** The NISR files are large, so they are not stored in this repository. They are downloaded
from the official sources above and uploaded to the platform, where they are indexed. [`data/`](data/) describes the
layout, the manifest format and the steps to add a dataset ([`data/nisr/README.md`](data/nisr/README.md)).

## What it communicates

- **For a question about Rwanda's statistics:** the figure, its source file, period and unit, with a chart or table
  when useful.
- **For a published dataset:** what the dataset contains (folders, files, sheets and columns), and answers drawn
  from the files themselves, with citations.
- **For a survey:** response rates per question, distributions, averages, and group comparisons with the method and
  the p-value. It also says when a test is not appropriate for the data.
- **For a class:** each student's marks per question, why marks were lost, and the class results in Excel.

## How to use it

1. Open **[www.bwenge.space](https://www.bwenge.space)** and sign in with Google or email, or open the
   [Telegram bot](https://t.me/Bwengebot).
2. Open **Public library** in the left sidebar to browse the published datasets, their folders and files.
3. Pick a dataset or a file and ask about it, for example:
   - *"What does this dataset contain?"*
   - *"Show unemployment by district as a chart"*.
   - *"Compare the figures for 2022 and 2023 and give me an Excel file"*.
4. Or simply type in the chat; Bwenge searches the published datasets by default and cites the files it used.
5. Live progress steps show what Bwenge is doing. Charts, tables and files arrive as cards that you can open or
   download.

**For developers and institutions:** the indexed data is available through the API (dataset repositories, folders,
files, search and cited sources), documented in [`docs/KNOWLEDGE_REPOSITORY.md`](docs/KNOWLEDGE_REPOSITORY.md).

## Also on the platform

| | |
|---|---|
| **Mark exams** | Attach scripts (phone photos, PDF, Word or a ZIP) or scan them with the camera, and press Mark. Every script comes back corrected in red pen as a PDF, with an Excel results file. The teacher reviews and adjusts marks before releasing them. |
| **Scan papers** | Phone-camera scanner with edge detection, on the web and as a Telegram Mini App. |
| **Forms and surveys** | Describe a survey in plain words. Bwenge builds it, checks it (readiness score, consent, wording, branching), publishes it and analyses the responses. |
| **Data analysis** | Upload CSV or Excel files, or ask about NISR statistics. Charts, tables, HTML reports and Excel files are made in the chat. All numbers are computed by code, never estimated by the AI. |
| **Learning** | Socratic tutor, roleplay practice, adaptive practice questions and anonymous class overviews for teachers. |

Teachers in Rwanda spend evenings marking paper scripts by hand, and schools, students and researchers collect
survey data that is rarely analysed properly. These tools turn both into evidence, supporting evidence-based
decision making in education (NST2 human-capital priority, Vision 2050).

## Run it

Requirements: Node.js 20 or later.

```bash
npm install
cp .env.example .env   # add an AI provider key and a session secret
npm run dev            # http://localhost:3000
```

```bash
npm test               # test suite
npm run build          # production build (dist/)
npm run nisr:index     # rebuild the NISR data index after adding a dataset
```

Production uses PostgreSQL (`npx prisma migrate deploy`). Deployment, billing, Telegram and the AI architecture
are documented in [`docs/`](docs/).

## Repository

```
README.md          this file
server.ts          server entry point
server/            API, AI tools, dataset repositories, marking, forms, statistics, Telegram bot
src/               web app (React)
data/              data layout; data/nisr/ holds the NISR manifest, schemas and index
demo/              demo video link
student_cards/     eligibility documents for both team members
prisma/            database schema and migrations
docs/              documentation
tests/             automated tests
```

## Team

Built in Rwanda for the NISR 2026 Big Data Hackathon. This submission is the team's own work. All external
libraries and data sources are acknowledged above and in `package.json`. 
1. Niyibizi Steven
2. Ngoboka Izere Herve Morin
