#!/usr/bin/env bash
# One-time: generate the android/ and ios/ runner projects, then lay MySEB's native lock code over them.
set -euo pipefail
cd "$(dirname "$0")"
flutter create --org space.bwenge --project-name myseb --platforms android,ios .
cp -R native-overlay/android/. android/
cp native-overlay/ios/Runner/AppDelegate.swift ios/Runner/AppDelegate.swift
# the generated MainActivity.kt lives in a different package folder: remove it so ours is the only one
find android/app/src/main/kotlin -name MainActivity.kt ! -path '*space/bwenge/myseb/*' -delete 2>/dev/null || true
# Android: our manifest replaces the generated one. iOS: add the myseb:// scheme + Guided Access note (see docs/MOBILE.md).
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes array' -c 'Add :CFBundleURLTypes:0 dict' -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string myseb' ios/Runner/Info.plist 2>/dev/null || echo "iOS: add the 'myseb' URL scheme to ios/Runner/Info.plist by hand (Xcode > Runner > Info > URL Types)."
flutter pub get
echo "Done. Run:  flutter run --dart-define=MYSEB_API=http://<laptop-ip>:4000"
