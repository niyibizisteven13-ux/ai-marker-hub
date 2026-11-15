import 'dart:async';
import 'package:flutter/services.dart';

/// Bridge to the native lock layer (Android: FLAG_SECURE + lock task; iOS: capture detection + Guided Access).
/// Native -> Dart events: split_screen, screen_recording, screenshot, focus_lost, user_leave, guided_access_denied.
class Lock {
  static const _ch = MethodChannel('myseb/lock');
  static final _events = StreamController<String>.broadcast();
  static Stream<String> get events => _events.stream;

  static void init() {
    _ch.setMethodCallHandler((call) async {
      if (call.method == 'event' && call.arguments is String) _events.add(call.arguments as String);
    });
  }

  /// Returns true when the OS really locked the device (Android screen pinning / iOS Guided Access request accepted).
  static Future<bool> lock() async {
    try { return await _ch.invokeMethod<bool>('lock') ?? false; } catch (_) { return false; }
  }

  static Future<void> unlock() async {
    try { await _ch.invokeMethod('unlock'); } catch (_) {}
  }
}
