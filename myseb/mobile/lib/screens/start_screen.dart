import 'dart:async';
import 'dart:io' show Platform;
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter/services.dart';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import '../services/api.dart';
import 'exam_screen.dart';

class StartScreen extends StatefulWidget {
  const StartScreen({super.key});
  @override
  State<StartScreen> createState() => _StartScreenState();
}

class _StartScreenState extends State<StartScreen> with WidgetsBindingObserver {
  final _code = TextEditingController();
  final _name = TextEditingController();
  String? _error;
  bool _busy = false;
  StreamSubscription<Uri>? _links;
  Timer? _updateTimer;
  Timer? _downloadTimer;
  String? _dismissedVersion;
  String _downloadStatus = 'idle';
  Map<String, dynamic>? _update;
  bool _checkingUpdate = false;
  String? _updateMessage;
  static const _updates = MethodChannel('myseb/updates');

  @override
  void initState() {
    super.initState();
    _initLinks();
    WidgetsBinding.instance.addObserver(this);
    _checkUpdates();
    _updateTimer = Timer.periodic(const Duration(minutes: 1), (_) => _checkUpdates());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkUpdates();
      if (_update != null) _checkDownload();
    }
  }

  Future<void> _checkUpdates({bool manual = false}) async {
    if (_busy || _checkingUpdate || !Platform.isAndroid) return;
    _checkingUpdate = true;
    try {
      final base = await Api.savedBase();
      final response = await http.get(Uri.parse('$base/updates/check?platform=android&version=$appVersion')).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) throw Exception('Update unavailable');
      final info = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted || _busy) return;
      setState(() {
        if (manual) _dismissedVersion = null;
        _update = info['available'] == true ? info : null;
        _updateMessage = manual && _update == null ? 'MySEB is up to date, or no compatible update has been published yet.' : null;
      });
      if (_update != null) await _checkDownload();
    } catch (_) {
      if (mounted && manual) setState(() => _updateMessage = 'Could not check for updates. Check your internet connection and try again.');
    } finally { _checkingUpdate = false; }
  }

  Future<void> _checkDownload() async {
    if (_busy || _update == null) return;
    final url = _update!['downloadUrl']?.toString();
    try {
      final status = await _updates.invokeMethod<String>('status', {'url': url}) ?? 'idle';
      if (!mounted || _busy || _update?['downloadUrl'] != url) return;
      setState(() {
        _downloadStatus = status;
        if (status == 'failed') _updateMessage = 'The download stopped. Choose Update now to try again.';
      });
      if (status == 'downloading') {
        _downloadTimer ??= Timer.periodic(const Duration(seconds: 2), (_) => _checkDownload());
      } else {
        _downloadTimer?.cancel();
        _downloadTimer = null;
      }
    } catch (_) {
      _downloadTimer?.cancel();
      _downloadTimer = null;
      if (mounted) setState(() => _downloadStatus = 'idle');
    }
  }

  Future<void> _applyUpdate() async {
    if (_busy || _update == null || _downloadStatus == 'downloading') return;
    final url = _update!['downloadUrl']?.toString();
    final ready = _downloadStatus == 'ready';
    setState(() {
      _downloadStatus = ready ? 'ready' : 'downloading';
      _updateMessage = null;
    });
    try {
      if (ready) {
        final result = await _updates.invokeMethod<String>('install', {'url': url});
        if (result == 'permission' && mounted) {
          setState(() => _updateMessage = 'Allow MySEB to install updates in Android settings, then return and tap Install update.');
        }
      } else {
        await _updates.invokeMethod<void>('start', {'url': url});
        await _checkDownload();
      }
    } catch (_) {
      if (mounted) setState(() {
        _downloadStatus = ready ? 'ready' : 'idle';
        _updateMessage = 'Could not open the update. Check your connection and try again.';
      });
    }
  }

  // The teacher's QR opens myseb://join?code=849277 : we only prefill the code, never switch server from a link.
  Future<void> _initLinks() async {
    try {
      final al = AppLinks();
      final first = await al.getInitialLink();
      if (first != null) _fromLink(first);
      _links = al.uriLinkStream.listen(_fromLink);
    } catch (_) {}
  }

  void _fromLink(Uri u) {
    final c = u.queryParameters['code'];
    if (u.scheme == 'myseb' && c != null && RegExp(r'^\d{6}$').hasMatch(c)) {
      final n = (u.queryParameters['name'] ?? '').trim();
      setState(() { _code.text = c; if (n.isNotEmpty) _name.text = n.length > 80 ? n.substring(0, 80) : n; });
      // The lecturer's link has the code and the student's name: go straight to the test.
      if (n.isNotEmpty && !_busy) _join();
    }
  }

  Future<void> _join() async {
    setState(() { _busy = true; _error = null; });
    try {
      final api = Api(await Api.savedBase(), await Api.deviceIdValue(), Platform.isIOS ? 'ios' : 'android');
      final s = await api.verify(_code.text.trim(), _name.text.trim());
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => ExamScreen(session: s, api: api)));
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _serverDialog() async {
    final c = TextEditingController(text: await Api.savedBase());
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Server address'),
        content: TextField(controller: c, keyboardType: TextInputType.url, decoration: const InputDecoration(hintText: 'http://192.168.1.10:4000')),
        actions: [TextButton(onPressed: () async { await Api.saveBase(c.text); if (mounted) Navigator.pop(context); }, child: const Text('Save'))],
      ),
    );
  }

  @override
  void dispose() { WidgetsBinding.instance.removeObserver(this); _updateTimer?.cancel(); _downloadTimer?.cancel(); _links?.cancel(); _code.dispose(); _name.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 400),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Padding(padding: const EdgeInsets.only(bottom: 8), child: Center(child: ClipRRect(borderRadius: BorderRadius.circular(26), child: Image.asset('assets/logo.png', width: 96, height: 96)))),
                  GestureDetector(
                    onLongPress: _serverDialog, // hidden: change the server (testing on a LAN)
                    child: const Text('MySEB', textAlign: TextAlign.center, style: TextStyle(fontSize: 52, fontWeight: FontWeight.w800, color: Color(0xFF60A5FA), letterSpacing: 2)),
                  ),
                  const Text('Secure exam browser', textAlign: TextAlign.center, style: TextStyle(color: Colors.white54)),
                  if (_update != null && _update!['version'] != _dismissedVersion) Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [
                    Text('MySEB ${_update!['version']} is available', style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text(_downloadStatus == 'downloading' ? 'Downloading the update…' : 'Android will ask you to confirm installation.'),
                    if (_downloadStatus == 'downloading') const LinearProgressIndicator(),
                    Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                      TextButton(onPressed: () => setState(() => _dismissedVersion = _update!['version']?.toString()), child: const Text('Later')),
                      FilledButton(
                        onPressed: _busy || _downloadStatus == 'downloading' ? null : _applyUpdate,
                        child: Text(_downloadStatus == 'ready' ? 'Install update' : 'Update now'),
                      ),
                    ]),
                  ]))),
                  if (Platform.isAndroid) TextButton(onPressed: _busy ? null : () => _checkUpdates(manual: true), child: const Text('Check for updates')),
                  if (_updateMessage != null) Text(_updateMessage!, textAlign: TextAlign.center),
                  const SizedBox(height: 32),
                  TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Your name', border: OutlineInputBorder())),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _code,
                    textAlign: TextAlign.center,
                    textCapitalization: TextCapitalization.characters,
                    style: const TextStyle(fontSize: 22, letterSpacing: 3),
                    decoration: const InputDecoration(labelText: 'Enter Exam Code', hintText: '8492-KIGALI-77', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 18),
                  FilledButton(onPressed: _busy ? null : _join, child: Padding(padding: const EdgeInsets.all(14), child: Text(_busy ? 'Checking…' : 'Start exam'))),
                  if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFF87171)))),
                  const SizedBox(height: 24),
                  const Text('Your phone will be locked until the exam ends. Leaving the app is recorded and pauses your exam.',
                      textAlign: TextAlign.center, style: TextStyle(color: Colors.white38, fontSize: 12)),
                ]),
              ),
            ),
          ),
        ),
      );
}
