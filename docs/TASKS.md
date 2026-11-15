# Tasks (assignments) for classes

A lecturer sets a task, shares one link, and students hand in photos, scans, PDF, Word, typed or voice answers with no account.

## Class list, deadline and marks (university classes)

- **Class list.** Paste "registration number, name" lines (from Excel). Only listed students can hand in; the name comes from the list; the dashboard shows who has not handed in. Header lines, duplicate ids and bad lines are skipped (`parseRoster`).
- **Hard deadline.** Optional: after the due date the link refuses hand-ins. Without it late work is accepted and flagged.
- **Receipt code.** A second hand-in by the same student replaces the first only with the receipt code from the first one, so knowing a classmate's number cannot overwrite their work. A student who lost the code asks the lecturer to remove the hand-in (the dashboard shows each receipt code).
- **Marks sheet.** `GET /api/assignments/:id/export.xlsx` (dashboard button "Marks (Excel)"): every listed student, status, time, late, mark, out of, percent, released.

Existing: automatic marking against a scheme, red-pen marked PDFs, private result links, gradebook.

## Hand in any kind of work (code, spreadsheets, slides, folders, video)

Students can hand in photos and scans, PDF, Word/OpenDocument/RTF, plain text, **code** (Python, JavaScript, TypeScript, Java, C/C++, C#, Go, Rust, PHP, SQL, R, MATLAB, HTML/CSS and more; `shared/handInTypes.ts`), **Jupyter notebooks**, **Excel and CSV**, **PowerPoint (.pptx)**, **videos** (mp4, mov), voice recordings, and **a whole folder**: "Send a folder" zips it on the student's device (libraries, `node_modules`, `.git`, build output and hidden files are left out) and hands it in as one file.

For marking, `server/services/assignments/handIn.ts` turns each hand-in into pages and joins them with the photos and PDFs in the order sent:
- code and text: monospace pages with the file name and line numbers; notebooks: markdown and code cells (outputs left out);
- spreadsheets and slides: their text;
- a folder: a contents listing, then every readable file (code, documents, spreadsheets, slides, page photos); binary files, videos and anything beyond the page limits are listed as "not shown";
- videos and recordings are kept and played in the dashboard but are not turned into pages.

Limits: 10 files of 25 MB per hand-in; a folder may hold up to 300 files and 100 MB once unpacked (checked before unpacking, so a "zip bomb" is refused); at most 40 pages per file and 120 pages per folder. Files are checked by their first bytes, not just their names (a program renamed `.zip` or `.py` is refused). The lecturer's dashboard opens every type in place (code with line numbers, spreadsheets as tables, slides, a folder's contents, video and audio players, PDF page by page).

Quiz and form "file" questions can ask for a folder (ZIP) or code too.

Not supported: old binary Office formats (.xls, .ppt, .doc beyond what Word reading handles) and OpenDocument spreadsheets and slides: ask students to save as .xlsx / .pptx. Code is marked by reading it; it is not run against tests yet.
