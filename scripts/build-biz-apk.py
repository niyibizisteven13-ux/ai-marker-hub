#!/usr/bin/env python3
"""Build a signed Android launcher for one published Bwenge4Biz business."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request
from xml.sax.saxutils import escape
from zipfile import ZipFile

ORIGIN = "https://bwenge.space"


def fetch(path, limit):
    # The server-side publisher reads public branding through the local app.
    if os.environ.get("BIZ_APK_USE_LOCAL_API") == "1":
        request = urllib.request.Request(
            "http://127.0.0.1:5000" + path, headers={"Host": "bwenge.space"}
        )
    else:
        request = urllib.request.Request(ORIGIN + path)
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Business asset exceeds the build size limit")
    return data


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug")
    parser.add_argument("--version-code", required=True, type=int)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", args.slug):
        parser.error("Enter a published business slug")
    if not 1 <= args.version_code <= 2100000000:
        parser.error("Enter a valid Android version code")

    api = "/api/biz/public/" + args.slug
    business = json.loads(fetch(api, 4 * 1024 * 1024))["business"]
    if business["slug"] != args.slug or business["category"] == "profile":
        parser.error("Enter a published Bwenge4Biz business slug")
    icon = fetch(api + "/icon-512.png", 2 * 1024 * 1024)
    if not icon.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("The business icon endpoint did not return PNG")
    app_id = "space.bwenge.biz.b" + hashlib.sha256(args.slug.encode()).hexdigest()[:32]
    sdk = Path(os.environ["ANDROID_HOME"])
    tools = sdk / "build-tools" / "35.0.0"
    android_jar = sdk / "platforms" / "android-35" / "android.jar"
    keystore = Path(os.environ["BIZ_APK_KEYSTORE"]).resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as directory:
        build = Path(directory)
        resources = build / "res"
        drawable = resources / "drawable-nodpi"
        drawable.mkdir(parents=True)
        (drawable / "business_icon.png").write_bytes(icon)
        manifest = build / "AndroidManifest.xml"
        name = escape(business.get("appName") or business["name"], {'"': "&quot;", "'": "&apos;"})
        manifest.write_text(f"""<manifest xmlns:android="http://schemas.android.com/apk/res/android"
            package="{app_id}" android:versionCode="{args.version_code}" android:versionName="1.{args.version_code}">
          <uses-sdk android:minSdkVersion="23" android:targetSdkVersion="35" />
          <uses-permission android:name="android.permission.INTERNET" />
          <uses-permission android:name="android.permission.CAMERA" />
          <uses-feature android:name="android.hardware.camera" android:required="false" />
          <application android:usesCleartextTraffic="false" android:label="{name}" android:icon="@drawable/business_icon" android:allowBackup="false">
            <activity android:name=".BusinessActivity" android:exported="true">
              <intent-filter><action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" /></intent-filter>
            </activity>
          </application>
        </manifest>""", encoding="utf-8")
        source = build / "BusinessActivity.java"
        source.write_text(f"""package {app_id};
import android.app.Activity;
import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.Arrays;

public final class BusinessActivity extends Activity {{
  private static final int CAMERA_REQUEST = 1;
  private static final String PAGE_PATH = "/b/{args.slug}";
  private WebView browser;
  private PermissionRequest camera;

  private static boolean businessOrigin(Uri url) {{
    return "https".equals(url.getScheme()) && (url.getPort() == -1 || url.getPort() == 443)
      && ("bwenge.space".equals(url.getHost()) || "www.bwenge.space".equals(url.getHost()));
  }}

  @Override public void onCreate(Bundle state) {{
    super.onCreate(state);
    browser = new WebView(this);
    browser.getSettings().setJavaScriptEnabled(true);
    browser.getSettings().setDomStorageEnabled(true);
    browser.getSettings().setAllowFileAccess(false);
    browser.getSettings().setAllowContentAccess(false);
    browser.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    browser.setWebViewClient(new WebViewClient() {{
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {{
        if (!request.isForMainFrame()) return false;
        Uri url = request.getUrl();
        if (businessOrigin(url) && PAGE_PATH.equals(url.getPath())) return false;
        String scheme = url.getScheme();
        if ("https".equals(scheme) || "tel".equals(scheme) || "mailto".equals(scheme)) {{
          try {{ startActivity(new Intent(Intent.ACTION_VIEW, url)); }}
          catch (ActivityNotFoundException unavailable) {{ /* No handler is installed. */ }}
        }}
        return true;
      }}
    }});
    browser.setWebChromeClient(new WebChromeClient() {{
      @Override public void onPermissionRequest(PermissionRequest request) {{
        if (!businessOrigin(request.getOrigin()) || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {{
          request.deny();
          return;
        }}
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {{
          request.grant(new String[]{{ PermissionRequest.RESOURCE_VIDEO_CAPTURE }});
        }} else if (camera == null) {{
          camera = request;
          requestPermissions(new String[]{{ Manifest.permission.CAMERA }}, CAMERA_REQUEST);
        }} else {{
          request.deny();
        }}
      }}

      @Override public void onPermissionRequestCanceled(PermissionRequest request) {{
        if (camera == request) camera = null;
      }}
    }});
    if (android.os.Build.VERSION.SDK_INT >= 30) {{
      browser.setOnApplyWindowInsetsListener((view, insets) -> {{
        android.graphics.Insets padding = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
        return insets;
      }});
    }}
    setContentView(browser);
    browser.loadUrl("{ORIGIN}" + PAGE_PATH + "?source=android");
  }}

  @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grants) {{
    super.onRequestPermissionsResult(requestCode, permissions, grants);
    if (requestCode != CAMERA_REQUEST || camera == null) return;
    PermissionRequest request = camera;
    camera = null;
    if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) {{
      request.grant(new String[]{{ PermissionRequest.RESOURCE_VIDEO_CAPTURE }});
    }} else {{
      request.deny();
    }}
  }}

  @Override protected void onDestroy() {{
    if (camera != null) {{ camera.deny(); camera = null; }}
    if (browser != null) browser.destroy();
    super.onDestroy();
  }}
}}
""", encoding="utf-8")
        classes = build / "classes"
        classes.mkdir()
        run("javac", "--release", "8", "-classpath", android_jar, "-d", classes, source)
        run(tools / "d8", "--min-api", "23", "--lib", android_jar, "--output", build,
            *sorted(classes.rglob("*.class")))
        unsigned = build / "unsigned.apk"
        run(tools / "aapt", "package", "-f", "-M", manifest, "-S", resources, "-I", android_jar, "-F", unsigned)
        with ZipFile(unsigned, "a") as apk:
            apk.write(build / "classes.dex", "classes.dex")
        aligned = build / "aligned.apk"
        run(tools / "zipalign", "-f", "4", unsigned, aligned)
        signed = build / "signed.apk"
        run(tools / "apksigner", "sign", "--ks", keystore, "--ks-key-alias", os.environ["BIZ_APK_KEY_ALIAS"],
            "--ks-pass", "env:BIZ_APK_KEY_PASSWORD", "--key-pass", "env:BIZ_APK_KEY_PASSWORD", "--out", signed, aligned)
        run(tools / "apksigner", "verify", signed)
        shutil.copyfile(signed, args.output)


if __name__ == "__main__":
    main()
