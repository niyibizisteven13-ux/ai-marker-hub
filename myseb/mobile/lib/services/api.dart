import 'dart:convert';
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

const _defaultApi = String.fromEnvironment('MYSEB_API', defaultValue: 'http://10.0.2.2:4000'); // 10.0.2.2 = laptop, from the Android emulator
const appVersion = '1.0.0';

class Session {
  Session({required this.token, required this.sessionId, required this.title, required this.examUrl,
      required this.status, required this.remainingSeconds, required this.deviceId, required this.platform, required this.api});
  final String token, sessionId, title, examUrl, deviceId, platform, api;
  String status;
  int remainingSeconds;
}

class HeartbeatResult {
  HeartbeatResult(this.status, this.reason, this.remainingSeconds, [this.noticeId, this.notice]);
  final String status; final String? reason; final int remainingSeconds;
  /// A short message from the teacher (or their assistant), carried by the heartbeat. Shown until the student taps OK.
  final String? noticeId, notice;

  /// The notice in a server answer, or nulls. Never trusts the shape: only two short strings are read.
  static List<String?> noticeOf(dynamic j) {
    final n = j is Map ? j['notice'] : null;
    if (n is Map && n['id'] is String && n['text'] is String) {
      final text = (n['text'] as String).trim();
      return text.isEmpty ? [null, null] : [(n['id'] as String), text.length > 300 ? text.substring(0, 300) : text];
    }
    return [null, null];
  }
}

class ApiException implements Exception {
  ApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class Api {
  Api(this.base, this.deviceId, this.platform);
  final String base, deviceId, platform;

  static Future<String> savedBase() async => (await SharedPreferences.getInstance()).getString('api') ?? _defaultApi;
  static Future<void> saveBase(String v) async => (await SharedPreferences.getInstance()).setString('api', v.trim().replaceAll(RegExp(r'/+$'), ''));

  static Future<String> deviceIdValue() async {
    final p = await SharedPreferences.getInstance();
    var id = p.getString('device');
    if (id == null) {
      final r = Random.secure();
      id = 'mob-${List.generate(24, (_) => r.nextInt(16).toRadixString(16)).join()}';
      await p.setString('device', id);
    }
    return id;
  }

  String get userAgent => 'MySEB/$appVersion (mobile; $platform)';

  Map<String, String> authHeaders(String token) => {
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        'X-MySEB-Key': token,
        'X-MySEB-Client': 'mobile',
        'X-MySEB-Device': deviceId,
      };

  Future<Session> verify(String code, String name) async {
    final http.Response r;
    try {
      r = await http
          .post(Uri.parse('$base/api/verify-code'),
              headers: {'Content-Type': 'application/json', 'User-Agent': userAgent},
              body: jsonEncode({'code': code, 'studentName': name, 'deviceId': deviceId, 'clientType': 'mobile', 'platform': platform}))
          .timeout(const Duration(seconds: 10));
    } catch (_) {
      throw ApiException('Cannot reach the exam server. Check your internet connection.');
    }
    final j = jsonDecode(r.body) as Map<String, dynamic>;
    if (r.statusCode != 200) throw ApiException((j['error'] ?? 'Could not verify the code.') as String);
    return Session(
      token: j['token'], sessionId: j['sessionId'], title: j['title'], examUrl: j['examUrl'], status: j['status'],
      remainingSeconds: j['remainingSeconds'], deviceId: deviceId, platform: platform, api: base);
  }

  Future<HeartbeatResult?> heartbeat(Session s) async {
    try {
      final r = await http.post(Uri.parse('$base/api/heartbeat'), headers: authHeaders(s.token), body: '{}').timeout(const Duration(seconds: 6));
      if (r.statusCode != 200) return null;
      final j = jsonDecode(r.body);
      final n = HeartbeatResult.noticeOf(j);
      return HeartbeatResult(j['status'], j['reason'], j['remainingSeconds'] ?? 0, n[0], n[1]);
    } catch (_) {
      return null;
    }
  }

  Future<HeartbeatResult?> violation(Session s, String type, [Map<String, dynamic>? detail]) async {
    try {
      final r = await http
          .post(Uri.parse('$base/api/violation'), headers: authHeaders(s.token), body: jsonEncode({'type': type, 'detail': detail ?? {}}))
          .timeout(const Duration(seconds: 6));
      if (r.statusCode != 200) return null;
      final j = jsonDecode(r.body);
      return HeartbeatResult(j['status'], j['reason'], s.remainingSeconds);
    } catch (_) {
      return null;
    }
  }

  Future<void> finish(Session s, String reason) async {
    try {
      await http.post(Uri.parse('$base/api/finish'), headers: authHeaders(s.token), body: jsonEncode({'reason': reason})).timeout(const Duration(seconds: 6));
    } catch (_) {}
  }
}
