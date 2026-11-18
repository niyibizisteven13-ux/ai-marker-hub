package space.bwenge.myseb

import android.app.ActivityManager
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import android.os.Build
import android.os.Environment
import android.provider.Settings
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
            if (examActive) {
                result.error("EXAM_ACTIVE", "Updates can only be installed outside an exam.", null)
                return@setMethodCallHandler
            }
            val downloads = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val prefs = getSharedPreferences("myseb_updates", MODE_PRIVATE)
            val downloadId = prefs.getLong("download_id", -1L)
            try {
                when (call.method) {
                    "start" -> {
                        val uri = Uri.parse(call.argument<String>("url").orEmpty())
                        val path = uri.path.orEmpty()
                        if (uri.scheme != "https" || uri.host != "github.com" ||
                            !Regex("/niyibizisteven13-ux/ai-marker-hub/releases/download/myseb-v[0-9]+[.][0-9]+[.][0-9]+/MySEB[.]apk").matches(path)) {
                            result.error("NOT_ALLOWED", "Choose an official MySEB release.", null)
                        } else if (downloadId != -1L && prefs.getString("download_url", null) == uri.toString()) {
                            result.success(null)
                        } else {
                            if (downloadId != -1L) downloads.remove(downloadId)
                            val release = uri.pathSegments[3]
                            val id = downloads.enqueue(DownloadManager.Request(uri)
                                .setTitle("MySEB update")
                                .setMimeType("application/vnd.android.package-archive")
                                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "$release.apk"))
                            prefs.edit().putLong("download_id", id).putString("download_url", uri.toString()).apply()
                            result.success(null)
                        }
                    }
                    "status" -> {
                        if (downloadId == -1L || call.argument<String>("url") != prefs.getString("download_url", null)) {
                            result.success("idle")
                            return@setMethodCallHandler
                        }
                        val status = downloads.query(DownloadManager.Query().setFilterById(downloadId)).use { cursor ->
                            if (cursor == null || !cursor.moveToFirst()) { prefs.edit().clear().apply(); "idle" }
                            else when (cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                                DownloadManager.STATUS_SUCCESSFUL -> "ready"
                                DownloadManager.STATUS_FAILED -> { downloads.remove(downloadId); prefs.edit().clear().apply(); "failed" }
                                else -> "downloading"
                            }
                        }
                        result.success(status)
                    }
                    "install" -> {
                        val uri = downloads.getUriForDownloadedFile(downloadId)
                        if (uri == null || call.argument<String>("url") != prefs.getString("download_url", null)) {
                            result.error("NOT_READY", "The update has not finished downloading.", null)
                        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                            result.success("permission")
                        } else {
                            startActivity(Intent(Intent.ACTION_VIEW)
                                .setDataAndType(uri, "application/vnd.android.package-archive")
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                            result.success("opened")
                        }
                    }
                    else -> result.notImplemented()
                }
            } catch (_: Exception) {
                result.error("UPDATE_FAILED", "Could not open the MySEB update.", null)
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
