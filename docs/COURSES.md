# Courses (lecturer dashboard)

A course is a named class for a term: roster (registration number, name, email), per-student accommodations, and the tasks and quizzes that belong to it. `/courses` in the app; API under `/api/courses` (signed-in lecturer only).

- **Roster**: paste from Excel ("222001234, Uwase Aline, aline@ur.ac.rw"). Re-importing updates names and keeps accommodations. Students are matched to hand-ins by registration number only. Hand-ins with a number that is not on the roster are listed as "unmatched" (typo or other course).
- **Work**: link tasks and quizzes. A quiz needs a question that asks for the registration number. The latest quiz attempt counts.
- **Dashboard**: every student against every piece of work (marked %, handed in, missing, late, flagged), column averages, and a status: *Needs attention* (average under 40% over at least two marked items, or half or more of the work missing), *Watch* (some work missing, late, or a flagged response), *OK*. Every status has a word, not only a colour.
- **Accommodations** (`Accommodation` in `server/services/courses/service.ts`): extra time %, no camera check, breaks, large text, voice or scribe answers, private note. Only the course owner can read them; the Excel sheet leaves them out. Exams read them through `accommodationsFor`.
- **Excel**: marks per student and item with status.

Data protection: the roster and accommodations are personal data. They are stored per lecturer (`COURSES_DIR`, default `data/courses`, 5 years), never sent to students, and removed when the course is deleted.

Not built yet: timed exams with a server clock and the camera presence check (see docs/FORMS.md, Test protection), folder submissions, code and essay marking, live monitoring while a test runs.
