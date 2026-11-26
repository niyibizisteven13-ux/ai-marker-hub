# Branded Bwenge4Biz customer apps

Set the independent launcher name and icon under **Settings → Customer app**. The existing business name and logo are the defaults. The installable web app has a business-specific name, URL and identity. On iPhone, open the business page in Safari, tap Share, then Add to Home Screen.

Each Android APK has a package ID derived from its business slug. Its launcher opens that business inside its own Android activity with its own sign-in storage. Camera permission is requested when a customer scans a QR code. Different businesses install alongside one another. Keep the slug and signing key stable for updates. Rebuild the APK after changing the logo or business name.

To enable signed Android downloads, configure the Actions secrets `BIZ_APK_KEYSTORE_BASE64`, `BIZ_APK_KEY_ALIAS` and `BIZ_APK_KEY_PASSWORD`. Use matching key and keystore passwords. In GitHub Actions, run **Bwenge4Biz Android launcher** with the published business slug. The workflow uses the existing production deployment SSH secrets to publish `<slug>.apk` atomically and verifies the public download matches the signed build. The default directory is `.bwenge-business-apks` under the app checkout. If using a custom directory, set the same absolute `BWENGE_BIZ_APK_DIR` in the server environment and the Actions production environment variables. The public business page checks for that file before showing the Android download button. The web app and icon routes need to be deployed before running the Android workflow against production.

From the business agent, owners can ask for their app link, change the app name, attach a new app icon, restore the business logo, check APK availability, or request a signed build. Build requests from chat need the production environment variable `BWENGE_BIZ_APK_WORKFLOW_TOKEN` with Actions write access limited to this repository. A successful dispatch queues a build. The workflow publishes the signed APK as its final step.

## Automatic publication on Hetzner

The server-side publisher checks for published, unsuspended Bwenge4Biz businesses every five minutes. It signs missing APKs with the existing production key and moves completed files into the download directory atomically. Failed builds retry on the next run and existing APKs are skipped.

Prerequisites on the host are JDK 17, Android SDK platform 35 and build tools 35.0.0 under `/opt/bwenge-android-sdk`, and the existing signing files under `/root/bwenge-apk-signing`. Set overrides for `ANDROID_HOME` or `BWENGE_BIZ_APK_DIR` in `/etc/default/bwenge-biz-apk-publisher` if needed. Use the same APK directory as the web service.

Run `sudo bash scripts/biz-apk/install-publisher.sh` from the approved production checkout. Re-run it after changes to the builder or publisher. Check runs with `journalctl -u bwenge-biz-apk-publisher.service`.
