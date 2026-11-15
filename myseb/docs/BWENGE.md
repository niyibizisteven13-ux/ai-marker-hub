# Using MySEB with bwenge.space

bwenge already has timed tests (`shared/examRules.ts`, `server/services/formExam`, `src/components/ExamRunner.tsx`: server clock, leave/fullscreen rules, pause). MySEB adds the *device lock* around them.

1. Run the MySEB backend next to bwenge (own Postgres DB, own port). Teacher creates an exam in the MySEB dashboard with **Exam URL = the bwenge test link** (e.g. `https://www.bwenge.space/f/<formId>`), and generates a code; keep the exam secret (`mseb_…`).
2. Store that secret on the bwenge form (e.g. `schema.exam.mysebSecret`; add it to `normalizeExam`).
3. Guard the form's page and API routes with the one-file middleware (does not touch bwenge's other routes):
```ts
import { remoteMySebGuard } from './myseb/remoteGuard.js';
app.use(['/f/:id', '/api/forms/:id'], remoteMySebGuard({
  mysebUrl: process.env.MYSEB_URL!,
  secretFor: async (req) => (await getForm(req.params.id))?.schema?.exam?.mysebSecret ?? null, // null = not required
}));
```
   Requests without a live MySEB session get `403 MySEB Needed`; paused/ended students get 403 too. It fails closed if MySEB is down.
4. Allow the MySEB server's origin and the bwenge origin in the desktop app (the app only navigates inside the exam origin) and use HTTPS for both.

I did not modify bwenge's own server files; the guard above is the only change needed there.
