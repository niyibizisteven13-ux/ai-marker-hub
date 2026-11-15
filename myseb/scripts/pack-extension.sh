#!/usr/bin/env bash
# Zips the Chrome extension so it ships next to the desktop and phone apps (upload it, or load unpacked for a pilot).
set -euo pipefail
cd "$(dirname "$0")/../extension"
out="../dist/myseb-extension.zip"
mkdir -p ../dist && rm -f "$out"
zip -q -r "$out" manifest.json background.js content.js popup.html popup.js
echo "Built myseb/dist/myseb-extension.zip"
