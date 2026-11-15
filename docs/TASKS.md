# Tasks (assignments) for classes

A lecturer sets a task, shares one link, and students hand in photos, scans, PDF, Word, typed or voice answers with no account.

## Class list, deadline and marks (university classes)

- **Class list.** Paste "registration number, name" lines (from Excel). Only listed students can hand in; the name comes from the list; the dashboard shows who has not handed in. Header lines, duplicate ids and bad lines are skipped (`parseRoster`).
- **Hard deadline.** Optional: after the due date the link refuses hand-ins. Without it late work is accepted and flagged.
- **Receipt code.** A second hand-in by the same student replaces the first only with the receipt code from the first one, so knowing a classmate's number cannot overwrite their work. A student who lost the code asks the lecturer to remove the hand-in (the dashboard shows each receipt code).
- **Marks sheet.** `GET /api/assignments/:id/export.xlsx` (dashboard button "Marks (Excel)"): every listed student, status, time, late, mark, out of, percent, released.

Existing: automatic marking against a scheme, red-pen marked PDFs, private result links, gradebook.
