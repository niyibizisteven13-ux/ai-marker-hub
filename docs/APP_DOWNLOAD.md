# The Bwenge app download (landing page)

Two different apps exist:
* **Bwenge** (this site): an Android app, published as the `apk-latest` release of this repository (`Bwenge.apk`).
* **MySEB** (student exam apps for Android, Windows, Mac, Linux): downloaded at `/myseb/download`, given to students by their lecturer.

The landing page's QR code ("Scan to get the app") and the **Download the app** button open `/get-app`, which is the **Bwenge** app:
* an **Android** phone is redirected straight to the APK (it downloads at once; Android may ask to allow installs from this source);
* **iPhone, iPad and computers** get a short page with the Android link and how to add Bwenge to the home screen (Safari → Share → Add to Home
  Screen; Chrome or Edge → Install). There is no separate iPhone or computer Bwenge app yet.

To serve the APK from another address set `BWENGE_APK_URL` (HTTPS only). Code: `server/routes/getApp.ts`.

Honest note: the APK in the release was built on 15 November from the `mobile-app/` project and nothing in this repository's workflows rebuilds
it any more, so it does not follow later changes to the site. Install it on a phone and check that it opens and signs in before telling people to use it.
