# MySEB mobile (Flutter)

```bash
cd myseb/mobile
./setup.sh                      # flutter create + lays the native lock code (Android Kotlin, iOS Swift) over it
flutter run --dart-define=MYSEB_API=http://<laptop-ip>:4000      # real phone on the same Wi-Fi
flutter run --dart-define=MYSEB_API=http://10.0.2.2:4000         # Android emulator (10.0.2.2 = your laptop)
```
Long-press the "MySEB" logo on the start screen to change the server address without rebuilding.
See `../docs/MOBILE.md` for what Android/iOS can and cannot enforce.
