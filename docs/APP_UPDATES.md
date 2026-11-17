# Updates for installed apps

## Bwenge (installed web app and browser)

Every production frontend build embeds its own build ID and publishes `build.json`. An open app compares that
ID with the deployed build on startup, every minute, on reconnect and when returning to the screen. This also
detects an old page opened after a deployment, rather than incorrectly accepting the new server version as its
own version. The prompt offers Update now or Later. Update checks connectivity and the new build, refreshes
the service worker registration and reloads after the user's choice. It does not clear account data, sign out,
or reload without consent. The prompt tells users to save work before updating. Later suppresses the same
version until reopening the app; a different future version can prompt again.

## MySEB desktop

Windows NSIS and Linux AppImage builds include electron-updater. Before an exam, the app checks the official
`/myseb/updates` feed at launch and every five minutes, and offers Check for updates on the start screen.
A user chooses Download update, then Install & restart after the verified download finishes. Downloads use
the release's checksum metadata. Installation and update prompts are blocked while an exam is active or
paused, and auto-install-on-quit is disabled. Downgrades are disabled. New installers must be published with
the generated latest.yml/latest-linux.yml and versioned files; old manifest file names keep pointing at the
same immutable installer even if another release arrives during download.

Mac builds offer a compatible release download and manual Applications installation. Automatic macOS
installation requires signed builds; the current unsigned DMG distribution is not represented as a working
silent updater. iPhone remains subject to the existing TestFlight/App Store distribution setup.

## MySEB Android

The start screen checks on startup, on resume and every five minutes, with Check for updates and Later.
Download & install opens the official GitHub APK download, and Android asks the user to confirm installation.
The native bridge rejects arbitrary download destinations and refuses to open an update while the exam is
locked. No update restarts or opens an external installer during an exam.

Android upgrades must use a persistent signing key and a higher versionCode. Configure these existing-key
GitHub Actions secrets: MYSEB_ANDROID_KEYSTORE_BASE64, MYSEB_ANDROID_STORE_PASSWORD,
MYSEB_ANDROID_KEY_ALIAS, MYSEB_ANDROID_KEY_PASSWORD. The build uses that key from temporary runner storage.
Only persistently signed builds publish MySEB-android-update.json, which enables Android update discovery.
Builds without a configured key remain testing downloads and are not advertised as compatible in-app updates.
An APK installed previously using an unrelated temporary debug key cannot accept a differently signed update.
Do not uninstall an existing app merely to work around signing: release with its existing signing key.

## Release and rollout

The MySEB build workflow stamps desktop and mobile versions consistently. A tag `myseb-v1.2.3` builds version
1.2.3; a manual build uses 1.0.<workflow run number>. It uploads versioned desktop installers, compatibility
aliases for the existing download links, and the updater manifests. It excludes draft, prerelease, unrelated,
and older releases from update discovery. Pull requests touching MySEB compile the native clients without
publishing a release. Merge alone changes the site source; publish a MySEB release to distribute native code.

Existing MySEB installations without this update feature require one installation of a new supported build
before they can offer future updates. Merging web changes does not retrofit native code into an old APK/EXE.
The browser extension continues to use its existing distribution; this change does not add extension updates.
