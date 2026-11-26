# Get the app (`/get-app`)

The landing page's QR code ("Scan to get the app") and **Download the app** button open `/get-app`, a public page that detects the device
(Android, iPhone/iPad, Windows, Mac, Linux) and shows what that device needs first.

## Two different apps
* **Bwenge** is an **installable web app** (PWA): **Install Bwenge** in one tap on Android, Windows, Mac and Linux (Chrome or Edge); on iPhone, Safari → Share →
  Add to Home Screen. It opens like an app, and it **updates itself every time it opens**, so there is no installer to keep current.
  Files: `public/manifest.webmanifest`, PNG icons `public/icons-*.png`, `public/sw.js` (bounded offline caching for visited public business pages, home, Research and downloads, plus versioned assets), registered in `src/main.tsx`.
* **MySEB** (the student exam app) has real installers (Windows .exe, Android .apk, Linux .AppImage, Mac .dmg) from `/myseb/download`. The page puts
  the one for the device first. There is no iPhone/iPad MySEB app.

There is **no native Bwenge installer** for Windows, Linux or Mac. The old `Bwenge.apk` (release `apk-latest`, built from `mobile-app/`) is an early prototype whose
server address is the Android emulator's (`10.0.2.2:3000`), so it does not work on a real phone and is not offered.

## Counting
Pressing **Install** (and the browser's "installed" event) for Bwenge, and **a MySEB download button**, are counted in AppSetting (`dl:<app>:<device>`, with per-day
counts for 120 days). The same person pressing twice within a minute counts once. **Admin → Settings → Platform controls → App downloads** shows totals, installs,
the last 7 and 30 days and a daily chart. API: `POST /api/app/count`, `GET /api/app/go/myseb/:device`, `GET /api/admin/platform/downloads`.
Counts are for orientation (a rare simultaneous press may be counted once).

## "A new version is ready"
`GET /api/app/version` returns the running site's build (`APP_BUILD`, the commit, or a hash of the built page). The open app asks every 5 minutes and when it comes
back to the screen; if the answer changed, a banner offers **Update** (a reload). Nothing reloads by itself, so a half-written message is never lost.

Not done: update notices inside the MySEB desktop and phone apps. They carry no build number, so that needs a CI change (pass the build number into the apps) and
a rebuild; and an update pop-up must never interrupt an exam.

## When a lecturer opens a live test
The message shared with students (live room → **Share on WhatsApp**, the chat's `launch_test` message, and the autopilot's "test is open" message to the lecturer)
is built by `shared/mysebShare.ts` and now carries **where to get the MySEB app**: `https://<site>/myseb/download`, which picks the installer for the device
that opens it. The live room also shows that link under the student link. Example:

```
Join S4 Biology midterm: https://www.bwenge.space/myseb/join/482910
Code: 482 910
Get the MySEB app (Windows, Android, Linux, Mac): https://www.bwenge.space/myseb/download
On a laptop or an Android phone the link above opens MySEB. On an iPhone it starts in the browser.
```

## Ratings, download numbers and the feedback survey
On `/get-app` each app card shows its **average rating** (stars, number of ratings) and **number of downloads**; until someone rates it says "No ratings yet" (no made-up numbers).
At the bottom, **How is it working for you?** takes a star rating (required) and an optional one-minute survey: how easy it was to install, what it is used for, what to
improve, and an email or phone number only if the person wants a reply (used only if they tick the permission).

* Public numbers only: downloads, installs, average and count (`GET /api/app/stats`, cached for a minute). Comments and contact details are never public.
* Anyone can send one (no account), so it is protected (`server/services/appFeedback.ts`): a hidden field that robots fill, at most 6 attempts an hour, **one rating per
  visitor per app per day**, short fields, known choices only. No IP address is stored (only an in-memory hash for the daily limit). Anonymous ratings can still be
  gamed by someone determined; they are for orientation, not proof.
* **Admin → Settings → Platform controls → Ratings and feedback**: averages with a star histogram, the latest answers, and **Download CSV**
  (`GET /api/admin/platform/feedback` and `.csv`; spreadsheet formulas from visitors are neutralised).
