import 'dart:async';
import 'dart:io' show Platform;
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import '../services/api.dart';
import 'exam_screen.dart';

class StartScreen extends StatefulWidget {
  const StartScreen({super.key});
  @override
  State<StartScreen> createState() => _StartScreenState();
}

class _StartScreenState extends State<StartScreen> {
  final _code = TextEditingController();
  final _name = TextEditingController();
  String? _error;
  bool _busy = false;
  StreamSubscription<Uri>? _links;

  @override
  void initState() {
    super.initState();
    _initLinks();
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
    if (u.scheme == 'myseb' && c != null && RegExp(r'^\d{6}$').hasMatch(c)) setState(() => _code.text = c);
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
  void dispose() { _links?.cancel(); _code.dispose(); _name.dispose(); super.dispose(); }

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
