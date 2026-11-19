# Secure exams from any form link (Google Forms, Microsoft Forms, Typeform…)

A teacher pastes the link of a form they already made. Students enter the exam code in MySEB, the device locks, and the form opens inside the app.

## What MySEB does
* **Locks the student to the form's own sites.** The app only opens the form's sites (for Google Forms: `docs.google.com`, `forms.gle`, and the Google sign-in page for forms that ask for an account). Every other address is refused and recorded as `blocked_navigation` (the site name only, never the whole address). It does not pause the exam: the page simply does not open.
* **All the usual exam rules** still apply: leaving the app pauses or ends the exam as the teacher chose, copy/paste and screenshots are blocked, other windows, extra screens and remote-control apps are noticed, the live monitor and the evidence timeline work.
* **Notices the submission.** For Google Forms the exam ends by itself when the form shows its "response recorded" page (`/formResponse`). For other tools the student presses **I have submitted** and confirms. The teacher sees "Submitted in MySEB".
* **Gives every student an exam key** (for example `K7M2P-9QXAB`), shown in the app's bar and pre-filled into a form field the teacher names. It is the same each time the same student comes back, and different for every student.
* **Never gives the form tool the MySEB secret.** The key header goes only to exam sites that check MySEB themselves (this server and bwenge.space), not to Google, Microsoft or any other site.

## What it cannot do (be honest with your school)
A form link is public. Nothing MySEB does can stop a student from also opening that link in an ordinary browser, because Google's servers do not ask MySEB. The **exam key** is the answer to that: add a required "MySEB key" question to the form. A response whose key does not match a student's key was **not** made inside MySEB. Download **Exam keys (CSV)** from the dashboard (student, key, submitted in MySEB, violations) and compare it with the form's responses.

## Teacher set-up
1. Make the form. In **Google Forms**: Settings → Responses → *Collect email addresses (Verified)* and *Limit to 1 response*; turn off *Show link to submit another response*. Add a required **Short answer** question named "MySEB key".
2. Pre-filled field: ⋮ → *Get pre-filled link*, type anything in "MySEB key", *Get link*, and copy the part like `entry.1234567890` from the long address.
3. In the MySEB dashboard: **New exam** → paste the form link. MySEB shows the provider, the sites students may use, and what to set. Open *Settings for this form* and paste the field name into **Key field**. Add any extra site the form needs (for example a school sign-in page).
4. *Create exam* → *Generate Code* → share the code. Students open MySEB, enter their name and the code.
5. After the exam: *Exam keys (CSV)* and compare with the responses.

## Microsoft Forms, Typeform, Jotform, SurveyMonkey, Tally, KoBoToolbox, Zoho Forms, Formstack, Airtable forms
Recognised by address, with their own sites and sign-in pages allowed. These tools stay on the same page after sending, so students press **I have submitted**. Add a "MySEB key" question and, where the tool supports pre-filling from the link, name the field in **Key field** (otherwise the student types the key shown in the app's bar).

## Any other website
MySEB locks the device to that site's own address (add extra sites if it needs them) and the student presses **I have submitted**. The MySEB key is not sent to it. If the site is your own and checks MySEB (see `remoteGuard.js`), tick *This is my own exam site that checks MySEB*.

## Where it is
Backend `myseb/backend/src/forms.js` (providers, analysis, exam key), routes in `routes.js` (`POST /exams`, `GET /forms/analyze`, `GET /exams/:id/form-keys`), tests in `test/forms.test.js`; desktop `desktop/src/formLock.js` and `main.js`; mobile `lib/screens/exam_screen.dart`. Not covered yet: the Chrome extension (low security, unchanged), and camera proctoring inside a third-party form (the camera is driven by the exam page, which a form tool does not provide).
