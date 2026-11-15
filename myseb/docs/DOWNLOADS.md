# Student app downloads

`https://bwenge.space/myseb/download` detects Windows, Android, macOS and Linux and redirects to the matching published MySEB installer. Use `?choose=1` to show all platforms or `?platform=windows` (also mac, linux, android, ios) to choose explicitly. Unknown devices receive the chooser. Missing installers receive an availability message instead of a guessed GitHub URL.

## Publish and deploy

1. Merge the download change and deploy/restart the MySEB backend and Bwenge server.
2. Remove obsolete `MYSEB_RELEASE_URL` settings and any `MYSEB_DL_*` overrides that point to the unrelated `apk-latest` release. Valid explicit HTTPS per-platform overrides remain supported.
3. Run **Build MySEB apps** on **main** with API base `https://bwenge.space/myseb`. After all builds succeed, it now publishes a uniquely tagged `myseb-v*` GitHub release with all four named assets. Manual runs on other branches do not publish. Existing tag-triggered releases still work.
4. Wait up to five minutes for the backend release cache to refresh. Verify Windows gets `MySEB-win.exe`, Android gets `MySEB.apk`, macOS gets `MySEB-mac.dmg`, and Linux gets `MySEB-linux.AppImage`.

The resolver ignores unrelated releases such as `apk-latest`, draft releases and prereleases. It queries public releases without credentials, caching results for five minutes and retaining previously discovered links during temporary API failures. It searches the most recent 100 releases. Installer downloads still require browser and operating-system confirmation; the site cannot silently install applications.

## iPhone and iPad

The current workflow does not build or publish an iOS app. Build/sign the iOS app using your Apple developer account and distribute it through App Store Connect (App Store or TestFlight). Once approved/available, set `MYSEB_DL_IOS` on the MySEB backend to the actual `https://apps.apple.com/...` or `https://testflight.apple.com/join/...` URL and restart it. Docker Compose forwards this variable. Until then iOS users receive an honest unavailable message. A raw unsigned IPA is not offered as a public installer.

## Validation

`cd myseb/backend && node --test test/downloads.test.js`
