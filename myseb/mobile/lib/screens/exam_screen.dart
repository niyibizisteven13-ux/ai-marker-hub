import 'dart:async';
import 'dart:ui' show FontFeature;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import '../services/api.dart';
import '../services/lock.dart';
import 'start_screen.dart';

/// The locked exam screen. Everything the student can do here is: look at the exam.
class ExamScreen extends StatefulWidget {
  const ExamScreen({super.key, required this.session, required this.api});
  final Session session;
  final Api api;
  @override
  State<ExamScreen> createState() => _ExamScreenState();
}

// Blocks selection, copy/cut/paste, long-press menu and drag inside the exam page. iOS: also the callout.
const _hookJs = r'''
(function(){ if (window.__mysebHook) return; window.__mysebHook = 1;
  var s = document.createElement('style');
  s.textContent = '*{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}input,textarea,[contenteditable="true"]{-webkit-user-select:text!important;user-select:text!important}';
  document.documentElement.appendChild(s);
  ['copy','cut','paste'].forEach(function(t){ document.addEventListener(t, function(e){ e.preventDefault(); MySEB.postMessage(t); }, true); });
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); }, true);
  document.addEventListener('click', function(e){ var t = e.target; if (t && t.tagName === 'INPUT' && t.type === 'file') MySEB.postMessage('file_open'); }, true);
  document.addEventListener('dragstart', function(e){ e.preventDefault(); }, true);
})();
''';

class _ExamScreenState extends State<ExamScreen> with WidgetsBindingObserver {
  late final WebViewController _wc;
  Timer? _hb, _clock, _leave;
  late int _remaining;
  late String _status;
  String? _reason;
  bool _offline = false, _locked = false, _ended = false;
  int _fails = 0;
  final _lastSent = <String, DateTime>{};
  DateTime _pickUntil = DateTime.fromMillisecondsSinceEpoch(0); // the system file/photo picker is open: leaving to it is not a violation
  bool get _picking => DateTime.now().isBefore(_pickUntil);
  late final String _origin;
  StreamSubscription<String>? _native;
  Completer<void>? _back; // completed when the student returns to the app (for example from the phone's Settings)

  Session get s => widget.session;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _status = s.status;
    _remaining = s.remainingSeconds;
    _origin = Uri.parse(s.examUrl).origin;
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    _startUp();
    _native = Lock.events.listen(_onNative);
    _initWebView();
    _hb = Timer.periodic(const Duration(seconds: 5), (_) => _beat());
    _clock = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted && _remaining > 0) setState(() => _remaining--); });
  }


  /// Ask for the camera first, then lock the phone. The system question and the way to the Settings page both need the phone to be free,
  /// and once it is locked the student cannot leave to answer them. Nothing is turned on here: the camera only starts when the lecturer
  /// asks for it and the student agrees on the exam page.
  Future<void> _startUp() async {
    try { await _prepareCamera(); } catch (_) {}
    final v = await Lock.lock();
    if (mounted) setState(() => _locked = v);
  }

  Future<void> _prepareCamera() async {
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;
    var status = await Permission.camera.status;
    if (status.isGranted) return;
    _pickUntil = DateTime.now().add(const Duration(seconds: 120)); // the system question is another screen: not a violation
    final go = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('Allow the camera?'),
        content: const Text('Your lecturer may ask to see you during the test. The camera is only on when they ask and you agree. Allow it now so the test is not interrupted later.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not now')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Allow')),
        ],
      ),
    );
    if (go != true || !mounted) { _pickUntil = DateTime.now(); return; }
    status = await Permission.camera.request();
    if (!status.isGranted && status.isPermanentlyDenied && mounted) {
      final open = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('The camera is blocked'),
          content: const Text('Your phone is not letting MySEB use the camera. Open Settings, choose Permissions, then Camera, and allow it. Then come back to MySEB.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not now')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Open Settings')),
          ],
        ),
      );
      if (open == true) {
        _pickUntil = DateTime.now().add(const Duration(minutes: 5)); // going to Settings and back: not a violation
        _back = Completer<void>();
        await openAppSettings();
        await _back!.future.timeout(const Duration(minutes: 5), onTimeout: () {});
        _back = null;
      }
    }
    _pickUntil = DateTime.now().add(const Duration(seconds: 3));
  }

  Future<void> _initWebView() async {
    _wc = WebViewController(
      // The exam page may use the camera (and microphone) only if the lecturer turned on live pictures or video (the page shows its own notice first).
      onPermissionRequest: (request) async {
        // Camera and microphone only for live video / listening, which the lecturer turns on and the page asks the student about first.
        final ok = request.types.every((t) => t == WebViewPermissionResourceType.camera || t == WebViewPermissionResourceType.microphone);
        if (!ok) { request.deny(); return; }
        // Android only lets the web view use the camera once the PHONE has asked the student and the student said yes: granting
        // inside the web view is not enough. The system question is another screen, so leaving to it must not count as leaving the exam.
        _pickUntil = DateTime.now().add(const Duration(seconds: 60));
        final need = <Permission>[
          if (request.types.contains(WebViewPermissionResourceType.camera)) Permission.camera,
          if (request.types.contains(WebViewPermissionResourceType.microphone)) Permission.microphone,
        ];
        var allowed = true;
        for (final p in need) {
          final status = await p.request();
          if (!status.isGranted) allowed = false;
        }
        _pickUntil = DateTime.now().add(const Duration(seconds: 3));
        allowed ? request.grant() : request.deny();
      },
    )
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..enableZoom(false)
      ..addJavaScriptChannel('MySEB', onMessageReceived: (m) {
        if (m.message == 'file_open') { _pickUntil = DateTime.now().add(const Duration(seconds: 60)); return; }
        _violation(m.message, {'via': 'page'});
      })
      ..setNavigationDelegate(NavigationDelegate(
        // The exam site only. Links to anywhere else are dropped.
        onNavigationRequest: (r) => (r.url.startsWith(_origin) || r.url.startsWith('about:') || r.url.startsWith('data:')) ? NavigationDecision.navigate : NavigationDecision.prevent,
        onPageFinished: (_) => _wc.runJavaScript(_hookJs),
      ));
    final platform = _wc.platform;
    if (platform is AndroidWebViewController) {
      // The page's small camera preview must start without a tap, or no pictures reach the lecturer.
      await platform.setMediaPlaybackRequiresUserGesture(false);
    }
    final ua = (await _wc.getUserAgent()) ?? '';
    // A plain Chrome tab never sends this marker, so the server can tell it apart.
    await _wc.setUserAgent('$ua ${widget.api.userAgent}');
    await _load();
  }

  // The header goes on the page request. Sub-resources (scripts, images, XHR) cannot carry it from a web view, so the
  // server answers with an HttpOnly cookie on this first request and honours it only for this app's user agent.
  Future<void> _load() => _wc.loadRequest(Uri.parse(s.examUrl), headers: {
        'X-MySEB-Key': s.token, 'X-MySEB-Client': 'mobile', 'X-MySEB-Device': s.deviceId,
      });

  /* ---------------- reporting ---------------- */
  Future<void> _violation(String type, [Map<String, dynamic>? detail]) async {
    if (_ended) return;
    final last = _lastSent[type];
    if (last != null && DateTime.now().difference(last) < const Duration(seconds: 1)) return;
    _lastSent[type] = DateTime.now();
    final r = await widget.api.violation(s, type, detail);
    if (r != null) _apply(r);
  }

  Future<void> _beat() async {
    if (_ended) return;
    final r = await widget.api.heartbeat(s);
    if (r == null) {
      if (++_fails >= 2 && mounted) setState(() => _offline = true);
      return;
    }
    _fails = 0;
    if (_offline && mounted) setState(() => _offline = false);
    _apply(r);
  }

  void _apply(HeartbeatResult r) {
    if (!mounted) return;
    final wasPaused = _status != 'IN_EXAM';
    setState(() { _status = r.status; _reason = r.reason; if (r.status != 'ENDED') _remaining = r.remainingSeconds > 0 ? r.remainingSeconds : _remaining; });
    if (r.status == 'ENDED') _finish(r.reason);
    if (r.status == 'IN_EXAM' && wasPaused) _load(); // teacher let us continue: reopen the exam
  }

  /* ---------------- leaving detection ---------------- */
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_ended) return;
    if (_picking && state != AppLifecycleState.resumed) return; // choosing a file or taking a photo for the hand-in
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        _leave?.cancel();
        _violation('background', {'state': state.name}); // home button, app switcher, another app: report at once, the OS may freeze us next
        break;
      case AppLifecycleState.inactive:
        // Notification shade, control centre, a call: only a violation if it lasts more than 1.5 s.
        _leave?.cancel();
        _leave = Timer(const Duration(milliseconds: 1500), () => _violation('leave', {'state': 'inactive'}));
        break;
      case AppLifecycleState.resumed:
        _leave?.cancel();
        if (_back != null && !_back!.isCompleted) _back!.complete();
        _beat();
        break;
      default:
        break;
    }
  }

  void _onNative(String e) {
    if (_picking && e != 'screen_recording' && e != 'screenshot') return;
    switch (e) {
      case 'split_screen': _violation('split_screen'); break;
      case 'screen_recording': _violation('screen_recording'); break;
      case 'screenshot': _violation('screenshot'); break;
      case 'user_leave': _violation('leave', {'how': 'home_or_recents'}); break;
      case 'focus_lost':
        _leave?.cancel();
        _leave = Timer(const Duration(milliseconds: 1500), () => _violation('leave', {'how': 'focus_lost'}));
        break;
      case 'focus_gained': _leave?.cancel(); break;
      case 'guided_access_denied': _violation('shortcut', {'note': 'guided access not granted'}); break;
    }
  }

  /* ---------------- ending ---------------- */
  Future<void> _confirmClose() async {
    _violation('close_attempt');
    final leave = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        title: const Text('Are you sure?'),
        content: const Text('Exam will end. You will not be able to come back in.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep taking the exam')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('End my exam', style: TextStyle(color: Colors.redAccent))),
        ],
      ),
    );
    if (leave == true) {
      await widget.api.finish(s, 'student_exit');
      _finish('student');
    }
  }

  Future<void> _finish(String? reason) async {
    if (_ended) return;
    _ended = true;
    _hb?.cancel(); _clock?.cancel(); _leave?.cancel();
    await Lock.unlock();
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    if (!mounted) return;
    setState(() { _status = 'ENDED'; _reason = reason; });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _hb?.cancel(); _clock?.cancel(); _leave?.cancel(); _native?.cancel();
    super.dispose();
  }

  String get _mmss => '${(_remaining ~/ 60).toString().padLeft(2, '0')}:${(_remaining % 60).toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final blocked = _ended || _status != 'IN_EXAM' || _offline;
    return PopScope(
      canPop: false, // Android back button
      onPopInvokedWithResult: (didPop, _) { if (!didPop && !_ended) _confirmClose(); },
      child: Scaffold(
        body: SafeArea(
          child: Stack(children: [
            Column(children: [
              Container(
                color: Colors.black, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: Row(children: [
                  Icon(Icons.circle, size: 10, color: blocked ? Colors.amber : Colors.greenAccent),
                  const SizedBox(width: 8),
                  Expanded(child: Text(s.title, overflow: TextOverflow.ellipsis)),
                  if (_locked) const Padding(padding: EdgeInsets.only(right: 8), child: Icon(Icons.lock, size: 14, color: Colors.white54)),
                  Text(_mmss, style: const TextStyle(fontFeatures: [FontFeature.tabularFigures()])),
                ]),
              ),
              Expanded(child: WebViewWidget(controller: _wc)),
            ]),
            if (blocked) Positioned.fill(child: _overlay()),
          ]),
        ),
      ),
    );
  }

  Widget _overlay() {
    String title, text; List<Widget> actions = [];
    if (_ended) {
      title = 'Exam finished';
      text = _reason == 'time_up' ? 'Time is up.' : 'Your exam has ended. You can close MySEB now.';
      actions = [FilledButton(onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const StartScreen())), child: const Text('Done'))];
    } else if (_offline) {
      title = 'Connection lost';
      text = 'Reconnecting… stay on this screen. Your teacher can see you are offline.';
    } else {
      title = 'Exam paused';
      text = 'You left the exam screen, so your teacher has been told. Wait for them to let you continue.';
    }
    return Container(
      color: const Color(0xFA020617), padding: const EdgeInsets.all(28),
      child: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(title, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
        const SizedBox(height: 18),
        ...actions,
      ])),
    );
  }
}
