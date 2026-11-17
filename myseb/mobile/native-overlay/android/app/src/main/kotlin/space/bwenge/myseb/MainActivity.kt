package space.bwenge.myseb

import android.app.ActivityManager
import android.content.Intent
import android.net.Uri
import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Native lock layer for MySEB.
 *  - FLAG_SECURE for the whole life of the activity: screenshots, screen recording, casting and the recents thumbnail are black.
 *  - startLockTask(): screen pinning. Home / Recents are disabled and the notification shade cannot be pulled down.
 *    Without a device-owner policy Android asks the student to confirm pinning once; with one (MDM / `dpm set-device-owner`)
 *    it is silent and cannot be undone by the student. See docs/MOBILE.md.
 *  - Split-screen / pop-up windows are refused (resizeableActivity=false in the manifest) and reported if they happen anyway.
 */
class MainActivity : FlutterActivity() {
    private var channel: MethodChannel? = null
    private var examActive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "myseb/updates").setMethodCallHandler { call, result ->
            if (call.method != "openDownload") { result.notImplemented(); return@setMethodCallHandler }
            val url = call.argument<String>("url") ?: ""
            val uri = Uri.parse(url)
            if (examActive || uri.scheme != "https" || uri.host != "github.com" || !uri.path.orEmpty().startsWith("/niyibizisteven13-ux/ai-marker-hub/releases/download/")) {
                result.error("NOT_ALLOWED", "Updates are allowed only before an exam and from the official release.", null)
            } else {
                try { startActivity(Intent(Intent.ACTION_VIEW, uri)); result.success(true) }
                catch (_: Exception) { result.error("NO_INSTALLER", "Cannot open the download.", null) }
            }
        }
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "myseb/lock").also { ch ->
            ch.setMethodCallHandler { call, result ->
                when (call.method) {
                    "lock" -> { examActive = true; result.success(lock()) }
                    "unlock" -> { examActive = false; unlock(); result.success(true) }
                    else -> result.notImplemented()
                }
            }
        }
    }

    private fun isPinned(): Boolean {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    }

    private fun lock(): Boolean {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_SECURE)
        try { startLockTask() } catch (_: Exception) { /* not allowed: Dart reports it as not locked */ }
        return isPinned()
    }

    private fun unlock() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        try { stopLockTask() } catch (_: Exception) {}
    }

    private fun emit(event: String) { if (examActive) channel?.invokeMethod("event", event) }

    // Home button / recents: the activity is asked to leave.
    override fun onUserLeaveHint() { super.onUserLeaveHint(); emit("user_leave") }

    // Notification shade, system dialogs, another app on top: we lose window focus (Dart waits 1.5 s before calling it a violation).
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        emit(if (hasFocus) "focus_gained" else "focus_lost")
    }

    override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean, newConfig: Configuration) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig)
        if (isInMultiWindowMode) emit("split_screen")
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (isInPictureInPictureMode) emit("split_screen")
    }
}
