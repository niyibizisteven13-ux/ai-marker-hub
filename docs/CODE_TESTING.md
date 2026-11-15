# Testing programs (code marking)

A task can test the programs students hand in. The lecturer gives the language and a list of tests (an input and the expected output, points, hidden or not). Each hand-in (a file, a typed program, or a whole folder) is compiled if needed and run once per test; the mark is the points of the tests it passes. The result shows in the task dashboard (chip, then each test with what the program printed), in the Classes dashboard and Excel marks, and, as the lecturer chooses, to the student (nothing, how many passed, or each test with hidden ones only pass/fail).

Languages: Python, JavaScript (Node), C, C++, Java. Add one in `server/services/codeRunner/languages.ts` and the runner image.

- **Main file**: `main.py`, `main.js`, `main.c`, `main.cpp`, `Main.java` (a few aliases such as `solution.py`), at the top or in the one wrapping folder; a single source file is used whatever its name. A folder with several source files and no main file is reported clearly. Typed code counts as the main file.
- **Comparing output**: ignoring extra spaces and blank lines (default), exactly line by line, or numbers within a small tolerance.
- **Limits per test**: time (1 to 30 s, default 5), 256 MB memory, 64 KB of output. Told apart in the result: wrong output, crashed, too slow, used too much memory, printed too much, did not compile.
- **Load**: at most two programs run at a time, so a class handing in together queues instead of overloading the server. The lecturer can run the tests again (for example after fixing a wrong expected output) or change them.

## Where programs run (important)

`server/services/codeRunner/`:
- **Docker (use this for real students).** Each hand-in runs in a throw-away container on your own server (nothing goes to a third party): no network, all capabilities dropped, `no-new-privileges`, read-only root file system, a small writable memory-backed /work, 1 GB / 1 CPU / 256 processes, an unprivileged user, a hard time limit. The student's file names never reach the Docker command line. Set up once on the server:
  ```bash
  docker build -t bwenge-code-runner:latest docker/code-runner
  # the app's user must be allowed to run docker; CODE_RUNNER=docker is the default when Docker works
  ```
  `CODE_RUNNER_IMAGE` changes the image name. Docker gives strong, not perfect, isolation (containers share the host kernel): keep the server updated, and prefer a separate small server for exams if you can. If the app itself runs in a container, do not mount the Docker socket into it; run the runner on the host or a separate machine instead.
- **local-unsafe (development only).** `CODE_RUNNER=local-unsafe` runs programs on this machine with no network, memory and CPU limits, and time and output caps, but a hostile program could still read other files. Refused in production unless `ALLOW_UNSAFE_CODE_RUNNER=yes`.
- **off.** `CODE_RUNNER=off`, or Docker is not available: the dashboard says why and hand-ins are kept unmarked.

`GET /api/assignments/code-status` reports whether this server can run programs.

Tested here with the development runner on real Python, Node, C, C++ and Java programs (correct, wrong, crashing, endless loop, memory hog, endless output, compile error, no network, project folders). The Docker runner's command line is unit-tested for every protective flag, but Docker could not run in the build environment: **try it once on your server with a hostile program** (a fork bomb, reading `/etc/passwd`, a network call) before relying on it.

# Safe Exam Browser and page-level protections (timed tests)

A web page cannot block a new tab or another program. What the platform does:
- **Safe Exam Browser (SEB)**, a free open-source lockdown browser (safeexambrowser.org) used by many universities. Tick "Require Safe Exam Browser" on a timed test and paste the **Browser Exam Key** from your SEB configuration. SEB adds `X-SafeExamBrowser-RequestHash` (SHA-256 of the request URL and the key) to every request; the server recomputes it for starting, every state/event/break call and the submit (`server/services/formExam/seb.ts`), so an ordinary browser cannot take the test. The key is stored only on the server and removed from the public form. Required with no key set means nobody can start (fails closed). Behind a reverse proxy the server must see the original host and protocol (`trust proxy` is set; pass `X-Forwarded-Proto` and `Host`). **Not tested with a real SEB here**: try one student on your real configuration first.
- **Page controls** (always in a timed test): losing window focus for more than 1.5 s (another tab, window or app) counts as leaving the page; print, save, view source, find, developer-tools keys and the context menu are blocked and counted; Print Screen clears the clipboard; a "leave this page?" prompt guards the test; full screen can be required. All of it is recorded for the lecturer and follows the leave rule (record, warn, pause, end). A determined student with a second device is not stopped.
