# Upload a file, get a quiz · Student transcripts

## Upload a file, get a quiz
Forms page → **Upload a file, get a quiz**. Choose notes, slides or a past paper (PDF with selectable text, Word, PowerPoint, Excel, text, HTML; up to
20 MB), the number of questions (1 to 40) and which kinds (multiple choice, true or false, short answer, several right answers, long answer).
Photos and scanned PDFs are **not supported yet**; the page says so.

* The model drafts the questions **only from your file** (`server/services/forms/fromFile.ts`). Nothing it writes is trusted:
  every question must carry a quote that really is in your file, a choice answer must be one of the options, duplicates and broken questions are dropped,
  points are bounded. A doubtful question is kept but **flagged**, with no answer key guessed.
* The quiz opens in the form builder **closed** (nobody can answer) with a review banner listing what to check, until you publish it.
  The first two questions are always *Full name* and *Registration number*, so the class gradebook and transcripts can match students.
* Marking is the same instant, free, deterministic marking every quiz uses. Long answers are marked by you.
* Limit: `FROM_FILE_PER_HOUR` (default 8) requests per lecturer per hour. Only requests that reach the model count. A file longer than 60,000 characters is cut, and the banner says so.
* Not covered yet: photos or scans, per-question explanations for students, and AI marking of long answers.

## Student transcripts
Teaching → a class → **Gradebook → Student transcripts**. Each student of the class gets **one private, unguessable link** (`/t/<token>`; no account).
They see every test and task of the class gradebook with their mark, a corrections link for tasks, and can **print or save as PDF**.

* **Only released marks are shown**, in the rows and in the average. A marked but unreleased mark shows "Marks not released yet" with no number; a quiz that hides
  scores from students stays hidden. Releasing a mark later shows it on the same link.
* **Copy all links** (ID, name, link) pastes into Excel or a message. **New link** replaces a leaked link; the old one stops working at once.
* Students are matched by registration number, then by name, the same way the gradebook does. Keep the link private: anyone with it sees that student's released marks.
* Storage: `TRANSCRIPTS_DIR` (default `./data/transcripts`).

## Marks in Excel, explanations and the MySEB report
* **Marks (Excel)** on a quiz's Results page: a file with **Results** (every attempt, total, percent, the mark for each question), **Questions** (how many got each right, the right answer, the most common wrong answer: which questions the class got wrong) and **Summary** (average, median, highest, lowest, pass rate). Each student counts once, by their latest attempt. Marks are recalculated from the **current** answer key, so fixing a key and exporting again corrects every student. Long answers are not included (you mark them).
* **Explanations**: each quiz question can have an explanation ("why the answer is right"). Students see it **after they submit**, next to the correct answer, only if you show answers; it is never in the public form. Upload-a-file fills it in from your file (short, using only the file).
* **MySEB report**: in the live room, **Download report (Excel)** gives a summary per student and a time-ordered timeline of everything the app saw (left the screen, lost connection, a second screen, a remote or recording app...). It is a record to weigh in a dispute, not proof, and holds no pictures, video or sound.
