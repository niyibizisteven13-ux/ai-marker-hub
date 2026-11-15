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
# iPhone: the camera/microphone texts iOS shows, the permission plugin's build switches (without them the camera is always "denied"),
# and iOS 15 or newer (a web page can only use the camera from iOS 14.3). Safe to run again.
if [ -f ios/Runner/Info.plist ]; then
  /usr/libexec/PlistBuddy -c 'Add :NSCameraUsageDescription string MySEB uses the camera when your lecturer asks to see you during the exam.' ios/Runner/Info.plist 2>/dev/null || true
  /usr/libexec/PlistBuddy -c 'Add :NSMicrophoneUsageDescription string MySEB uses the microphone only when your lecturer chooses to listen during the exam.' ios/Runner/Info.plist 2>/dev/null || true
fi
python3 - <<'PY'
import re, pathlib
pod = pathlib.Path('ios/Podfile')
if pod.exists():
    t = pod.read_text()
    t = re.sub(r"^#?\s*platform :ios, '[0-9.]+'", "platform :ios, '15.0'", t, count=1, flags=re.M)
    if 'PERMISSION_CAMERA' not in t:
        t = t.replace("    flutter_additional_ios_build_settings(target)\n", "    flutter_additional_ios_build_settings(target)\n    target.build_configurations.each do |config|\n      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)', 'PERMISSION_CAMERA=1', 'PERMISSION_MICROPHONE=1']\n      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'\n    end\n", 1)
    pod.write_text(t)
proj = pathlib.Path('ios/Runner.xcodeproj/project.pbxproj')
if proj.exists():
    proj.write_text(re.sub(r"IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;", "IPHONEOS_DEPLOYMENT_TARGET = 15.0;", proj.read_text()))
PY
flutter pub get
echo "Done. Run:  flutter run --dart-define=MYSEB_API=http://<laptop-ip>:4000"
