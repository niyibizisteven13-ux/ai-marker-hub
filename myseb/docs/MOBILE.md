# Mobile: what is enforced, what is only detected

| Feature | Android | iOS |
|---|---|---|
| Block screenshots / recording | `FLAG_SECURE` (whole app, also recents thumbnail) — enforced | Cannot block. `UIScreen.capturedDidChangeNotification` + `userDidTakeScreenshotNotification` → screen covered + violation |
| Block Home / Recents | `startLockTask()` screen pinning. Confirm prompt unless device owner | Guided Access via `UIAccessibility.requestGuidedAccessSession`; works only on supervised devices with an MDM single-app profile, otherwise student triple-clicks the side button |
| Notification shade | Disabled while pinned | Disabled in Guided Access |
| Split-screen | `resizeableActivity=false` + `onMultiWindowModeChanged` violation | n/a |
| Copy / paste / select | CSS + JS hook in the WebView | same (`-webkit-touch-callout:none`) |
| Background | `didChangeAppLifecycleState(paused)` → `background` violation + PAUSED; `inactive` > 1.5 s → `leave` | same |
| Heartbeat | every 5 s; 20 s silence → LEFT | same |

Fully silent kiosk on Android: provision the phone as device owner (`adb shell dpm set-device-owner space.bwenge.myseb/.AdminReceiver`) and whitelist the package for lock task. Not included; needs a DeviceAdminReceiver.

**Not run here:** the Flutter and native code were written without a Flutter SDK/emulator available. Run `flutter analyze` and test on a real device before relying on it.

**Camera and microphone (Android):** the app declares both permissions, and now asks the student for them (the system "Allow MySEB to take pictures?" question) the first time the exam page asks for the camera, but only when the lecturer turned live pictures/video on. While that system question is on screen, leaving the exam screen is not counted as a violation (60 s grace). If the student chose "Don't allow", the page says where to turn it on (Settings → Apps → MySEB → Permissions). On a device-owner kiosk, grant them in advance: `adb shell pm grant space.bwenge.myseb android.permission.CAMERA`.
