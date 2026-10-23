# Interactive learning platform

This document describes what was built from the *interactive AI learning blueprint*. It also states honestly what each part does and does not do.

## 1. 3D and spatial models

The AI builds explorable 3D models in chat with the tool `create_3d_model`.

**Scene format and storage**
- The scene format (`application/vnd.bwenge.scene+json`) is defined and validated in `src/lib/scene/spec.ts`. The same code runs on the server and in the browser.
- A scene is made of named parts: simple solids, tubes, extrusions and lathes. Connections link parts (bonds, beams, cables). Scenes can also have guided views, quizzes and annotations.
- A `molecule: { atoms, bonds }` shortcut expands to a ball-and-stick model with CPK colours.
- The model is saved as a `model3d` attachment.

**Where it can be viewed**
- **Chat:** `src/components/scene3d/SceneViewer.tsx` (three.js) renders the model inline.
- **Full page:** `/model?src=…` opens the same viewer full page.
- **Telegram:** the model is sent as a standalone `.html` viewer, built by `server/services/spatial/sceneHtml.ts`. Its scene data is embedded as JSON with `<` escaped.

**Viewer features**

| Feature | What it does |
|---|---|
| Rotate, zoom, labels | Navigate the model and see part names. |
| Tap a part | Shows the part's description and properties. |
| Isolate and hide | Focus on one part or remove it from view. |
| Exploded view | Moves parts apart to show how they fit. |
| Section plane | Cuts through the model to show the inside. |
| Guided views | A step-by-step tour of chosen camera positions. |
| Quiz | "Click the …" questions answered by selecting a part. |
| Stress heatmap | Colours parts by `stress` (0–1). |
| Gravity demo | Dynamic parts fall and land on fixed parts. |
| Sun and seasons | Sun position for a latitude, month and hour; Kigali by default. |
| First-person walkthrough | Walk through a building on foot. |
| WebXR VR | Opens the model in a VR headset. |
| PNG export | Saves a picture of the current view. |
| glTF (`.glb`) export | Saves the model for Blender, game engines and haptic or VR tools. |

**Cross-disciplinary cost analysis**
- `analyze_3d_model` and the in-viewer bill of materials compute volume, then mass (volume × density), then cost (mass × RWF per kg).
- The user can supply their own prices and a scale factor. Mass and cost scale with k³.

**Honest limits**
- Stress values are illustrative inputs from the model. This is not finite-element analysis.
- Physics is a simple gravity and collision demo.
- Haptics means glTF export only.
- VR needs a WebXR headset.
- Nothing is rendered server-side; Telegram gets the HTML viewer.

## 2. Learning modes in chat (web and Telegram)

The mode is picked under the message box on the web. On Telegram it is set with `/socratic [topic]` (or `/tutor`), `/roleplay [character]` or `/normal`.

- **Settings:** the mode is validated by `parseLearning` in `server/services/learning/modes.ts`. Its instructions are added to the system prompt on both chat paths.
- **Socratic guide (anti-cheating):**
  - It never gives final answers, full solutions, finished code or finished essays.
  - It asks for the student's own attempt and uses a 4-step hint ladder.
  - It names flawed reasoning precisely and ends each reply with a question.
- **Roleplay:**
  - Built-in scenarios: café English, a French market, a job interview, a moot court, a debate, and a historical figure (Marie Curie). Custom characters are also possible.
  - It takes a target language and CEFR level and adds one *Coach:* correction per turn.
  - Saying "end" gives a feedback report.
  - On the web, speech input and read-aloud use the browser's speech APIs. Recognition quality depends on the browser and the language.

## 3. Adaptive practice (`/learn`)

The adaptive logic lives in `server/services/learning/adaptive.ts` and `practice.ts`. The routes are in `server/routes/learnRoutes.ts`, mounted at `/api/learn` behind authentication.

**How practice adapts**
- Each learner has a mastery estimate (0–1) and a working level (1–5) for each topic.
- Questions (multiple-choice, numeric or short answer) are generated at that level.
- Each wrong multiple-choice option is tagged with the misconception it reflects.
- Mastery uses an Elo-style update: surprising results move it more, and each hint used reduces the credit.
- Three correct answers in a row raise the level. Two misses lower it. Repeated misses at level 1 switch to questions on a prerequisite idea.
- **Metacognition:** the learner rates how sure they are (1–5). The Brier score tracks calibration, and the feedback calls out being "sure but wrong" or "unsure but right".

**Grading and protections**
- Multiple-choice, numeric (1% tolerance, fractions accepted) and exact short answers are graded objectively.
- Open answers are graded by the AI on a 0, 0.5 or 1 scale. The learner's answer is passed as data, so instructions written inside it are ignored.
- The answer, unrevealed hints and the misconception map never leave the server before the learner answers.

**Credits:** each generated question and each AI grading is metered as ordinary chat credits (`checkUsage` / `recordUsage`).

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/learn/skills` | The learner's topics: mastery, level, accuracy and calibration. |
| POST | `/api/learn/practice/next` | `{topic, language?}` returns the open question, or a new one at the learner's level. |
| POST | `/api/learn/practice/:id/hint` | Reveals the next hint. |
| POST | `/api/learn/practice/:id/answer` | `{response, confidence?}` returns the score, feedback, answer, explanation, change in mastery, calibration note and level change. |
| GET/POST | `/api/learn/classes` | List the user's classes, or create one (`{name}` returns a 6-character code). |
| POST | `/api/learn/classes/join` | `{code}` joins a class. |
| DELETE | `/api/learn/classes/:id/membership` | Leave a class. |
| DELETE | `/api/learn/classes/:id` | Archive a class (owner only). |
| GET | `/api/learn/classes/:id/dashboard` | The class synthesis dashboard (owner only). |

## 4. Classroom synthesis dashboard

Teachers create a class and share its code, and students join with it. The dashboard shows each topic's results in aggregate:
- number of students, number of answers and accuracy;
- mean mastery and mean level;
- mastery bands: struggling (< 0.4), developing (< 0.7) and secure;
- the most common misconceptions.

**Privacy (k-anonymity, k = 5)**
- No names or user ids are returned.
- Topics practised by fewer than 5 students are counted but not broken down.
- A misconception is listed only when at least 3 students share it.
- "Active this week" is hidden for classes with fewer than 5 students.
- Students cannot open the dashboard.

## Deploy

1. Run the database migration `20261024000100_learning` with `npx prisma migrate deploy`. It adds `TelegramSession.learning` and the `LearnerSkill`, `PracticeItem`, `Classroom` and `ClassMember` tables.
2. To turn the 3D tools off, set `ENABLE_3D_TOOLS=false`.

## Tests

- `tests/learning_blueprint.test.ts` covers scenes, molecules, materials cost, sun path, the 3D tools, the HTML viewer, learning modes, the adaptive model, grading, practice over HTTP with a scripted model, and the classes dashboard with k-anonymity.
- `tests/telegram_bot.test.ts` covers the Telegram learning-mode commands.
