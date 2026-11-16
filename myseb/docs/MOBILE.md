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
**Camera held by another app:** a phone camera can be used by one app at a time, so a call, the camera app or a screen recorder can make the camera "busy". MySEB cannot take it from them, but it copes: (1) before the phone is locked the app asks once for the camera and, if the student refused earlier, offers the way to Settings (not possible once the phone is locked); (2) the exam page opens the camera with several tries (the settings it wants, simpler settings, any camera, each camera by name, then once more after a moment) and, if it is still busy, tries again by itself every 4 s while the page is in front and at once when the student comes back to it; (3) the lecturer sees "Another app is using the camera" in the live room (not a rule break by itself), and the student is told to close the other app. The same applies to students in a browser before the test opens. The hidden camera preview is allowed to start without a tap (`setMediaPlaybackRequiresUserGesture(false)`).
