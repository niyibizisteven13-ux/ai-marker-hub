# Branded Bwenge4Biz customer apps

The owner's existing public business logo supplies the launcher icon. The installable web app has a business-specific name, URL and identity. On iPhone, open the business page in Safari, tap Share, then Add to Home Screen.

Each Android APK has a package ID derived from its business slug. Its launcher opens that business in a browser Custom Tab so sign-in and camera permissions use the browser. Different businesses install alongside one another. Keep the slug and signing key stable for updates. Rebuild the APK after changing the logo or business name.

To enable signed Android downloads, configure the Actions secrets `BIZ_APK_KEYSTORE_BASE64`, `BIZ_APK_KEY_ALIAS` and `BIZ_APK_KEY_PASSWORD`. Use matching key and keystore passwords. In GitHub Actions, run **Bwenge4Biz Android launcher** with the published business slug. Extract the signed APK from the workflow artifact and place it as `<slug>.apk` in the production directory configured by `BWENGE_BIZ_APK_DIR`. The public business page checks for that file before showing the Android download button. The web app and icon routes need to be deployed before running the Android workflow against production.
