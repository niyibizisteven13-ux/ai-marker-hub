# MySEB on iPhone and iPad

The iPhone app is the same Flutter app as the Android one (`myseb/mobile`). What is ready: the app, its locking layer (screen-recording and screenshot detection, the exam hidden in the app switcher, a request for Guided Access), the camera and microphone permissions, and a build in GitHub that can sign the app and send it to TestFlight. What is **not** possible without you: Apple only lets apps onto iPhones through its own channels, and they need an Apple account.

> Status: written without a Mac or an Apple account, so it has never been built or run on a real iPhone. The first TestFlight build is the first real test. Expect to fix small things.

## The honest limits of an iPhone
| | iPhone |
|---|---|
| Block Home / app switching | **Cannot be forced.** The student turns on *Guided Access* (Settings → Accessibility → Guided Access; then triple-click the side button inside MySEB). The app asks iOS to start it, which only works on school-managed (supervised) phones. |
| Screenshots | Cannot be blocked, but are **detected** and reported. |
| Screen recording / mirroring | **Detected**: the screen is covered and the lecturer is told. |
| Leaving the app | **Detected**: the exam is paused or the leave rule applies. |
| Camera and microphone | Works (iOS 15 or newer). The student is asked once. |
| Screen sharing to the lecturer | Not available on iPhone: it shows the camera instead. |

So an iPhone is a "detect and report" device unless the school manages it (Apple Configurator / MDM "Single App Mode"), which locks it properly.

## How to get it onto students' iPhones (recommended: TestFlight)
Cost: the Apple Developer Program, about **US$99 per year**. There is no free way to put an app on many iPhones.

1. **Join the Apple Developer Program** at developer.apple.com/programs (it can take a day or two to be approved).
2. **Create the app**: App Store Connect → *Apps* → **+** → New App. Platform iOS, name *MySEB*, bundle ID `space.bwenge.myseb` (register it under *Certificates, Identifiers & Profiles → Identifiers* first if it is not in the list), any SKU.
3. **Create an API key**: App Store Connect → *Users and Access → Integrations → App Store Connect API* → **+**, access **App Manager** (or Admin). Note the **Key ID** and the **Issuer ID**, and download the `.p8` file (you can download it only once).
4. **Add four secrets** in GitHub: repository → Settings → Secrets and variables → Actions → *New repository secret*:
   - `APPLE_TEAM_ID`: your 10-character Team ID (developer.apple.com → Membership details)
   - `ASC_KEY_ID`: the Key ID
   - `ASC_ISSUER_ID`: the Issuer ID
   - `ASC_KEY_P8`: the whole text of the `.p8` file (including the BEGIN/END lines)
5. **Build**: Actions → **Build MySEB apps** → Run workflow. The `ios` job signs the app (Xcode creates the certificates by itself) and uploads it to TestFlight. It shows up in App Store Connect → TestFlight after about 10-30 minutes.
6. **Let students in**: TestFlight → *External Testing* → create a group → turn on **Public Link** (up to 10,000 testers). The first build needs Apple's short Beta App Review (usually under a day). Students install Apple's free *TestFlight* app, then open your link. Each build stays usable for 90 days, so run the build again before it expires.
7. **Show it on the download page**: in your hosting settings set `MYSEB_DL_IOS` to the public TestFlight link (`https://testflight.apple.com/join/...`). The page `bwenge.space/myseb/download` then offers it to iPhones.

For a permanent solution, submit the same build for the App Store (App Store Connect → the build → *Submit for review*). Apple reviews apps that lock a device carefully; explain it is an exam app for schools.

## Free for everyone: the browser (works on any iPhone today)
No app and no Apple account needed. In the live room open **Settings** and turn on **Browsers**. An iPhone student opens your test link in Safari and sees **No app? Use this browser**; they type their name and the exam code on that page and the test starts. The same works on any phone or laptop.
It **cannot lock the device**: a web page cannot stop a student from switching apps. It *watches* instead, and reports to the live room: leaving the page or switching app (after 1.5 s), copy / paste, right-click, developer-tool and print shortcuts, leaving full screen (computers). Your "If a student leaves" rule applies (record, pause, pause then end, or end), you see the student in the live room marked *browser*, and you can pause or end them from there. On computers the camera and the whole-screen share work as in the app; an iPhone shows the camera.
**Strict rules (the default for browsers; Settings → Browser rules):** the student must turn on the camera and show their face before the test opens, and the student is **disqualified on the spot** (a clear message says opening another app or tab is treated as cheating, and the live room shows "Disqualified · Hid the tab") if they leave the page (another app or tab, a locked screen), close the tab, turn the camera off, or take their face out of the camera for more than 5 seconds (a countdown warns them at 4 s). The browser student gets **one attempt**: the same browser cannot start again, under the same or another name (clearing the browser's data is the only way round; the lecturer sees the extra session). The face check runs on the phone (nothing is uploaded); the first time it loads about 10 MB. A web page **cannot close the student's other apps**, so "closing everything" is done the other way round: any other app that comes to the front ends the test. Copy / paste and several faces in the picture are recorded only. Turn **Strict for browsers** off to use your own "If a student leaves" rule instead.
**More rules for browsers (live room → Settings):**
- **Honesty statement:** before the camera starts, the student ticks that they will work alone with no other person, app, device or notes.
- **Faces in the camera:** ignore, warn (recorded, with a banner) or disqualify after 5 seconds when more than one person is in the picture. The face finder is built for a person facing a phone, so a second person who is small or far behind may not be seen: treat this as one signal, not proof.
- **Student card:** the student shows their card after their face is seen; you see one picture in the live room and press **Let in** or **Refuse** (refused ends their test). The picture lives only in the server's memory until you decide (or 30 minutes), never in the database.
- **Looked aside:** the seconds a student's face was turned well away from the camera are shown on their tile for you to judge. It never disqualifies anyone.
- **Let back in:** on a disqualified student's tile, **Let back in** puts them back where they were (recorded in their log). Their page restarts by itself. It does not work for students you ended yourself or whose time is over.
- **Report:** the Excel report has Disqualified, Let back in, Student card and "Look at this" columns.
**Weak networks:** nobody is rejected for a poor connection. The heartbeat slows down (up to 15 s) instead of failing, a student is marked away only after three times the normal wait, a violation that could not be sent waits and is sent when the connection returns (so going offline is not a way to hide leaving), pictures to the lecturer get fewer and smaller on 2G/3G or data saver, and the page shows "Weak connection: stay on this page".
How it is kept honest: the key is a secure cookie the page cannot read, tied to the same browser; a cookie taken to another browser is refused and the lecturer is told. It is the lighter option, so use the app where students can.

## Without paying Apple (an app on the iPhone)
Only for a few students: send them the unsigned file from the workflow run (`myseb-iphone-unsigned` artifact) and have them install it with a free tool such as Sideloadly or AltStore using their own Apple ID. The app then **stops working after 7 days** and needs a computer to renew. It is not published on the download page on purpose.

## What the build does
`.github/workflows/myseb-apps.yml`, job `ios` (macOS runner): runs `myseb/mobile/setup.sh` (adds the camera and microphone texts, the permission plugin's switches and iOS 15 as the minimum), builds an unsigned copy to prove it compiles, and, only if the four secrets exist, archives with automatic signing and uploads to TestFlight. The other apps' release does not wait for it.
