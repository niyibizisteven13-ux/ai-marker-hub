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
    with urllib.request.urlopen(ORIGIN + path, timeout=20) as response:
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
          <application android:label="{name}" android:icon="@drawable/business_icon" android:allowBackup="false">
            <activity android:name=".BusinessActivity" android:exported="true">
              <intent-filter><action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" /></intent-filter>
            </activity>
          </application>
        </manifest>""", encoding="utf-8")
        source = build / "BusinessActivity.java"
        source.write_text(f"""package {app_id};
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.TextView;

public final class BusinessActivity extends Activity {{
  @Override public void onCreate(Bundle state) {{
    super.onCreate(state);
    Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse("{ORIGIN}/b/{args.slug}?source=android"));
    Bundle customTab = new Bundle();
    customTab.putBinder("android.support.customtabs.extra.SESSION", null);
    browser.putExtras(customTab);
    try {{
      startActivity(browser);
      finish();
    }} catch (ActivityNotFoundException unavailable) {{
      TextView message = new TextView(this);
      message.setPadding(32, 48, 32, 32);
      message.setText("Install a web browser to open this business app.");
      setContentView(message);
    }}
  }}
}}
""", encoding="utf-8")
        classes = build / "classes"
        classes.mkdir()
        run("javac", "--release", "8", "-classpath", android_jar, "-d", classes, source)
        run(tools / "d8", "--min-api", "23", "--lib", android_jar, "--output", build,
            next(classes.rglob("BusinessActivity.class")))
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
