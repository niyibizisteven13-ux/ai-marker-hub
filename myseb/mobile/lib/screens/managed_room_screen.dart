import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

class ManagedRoomScreen extends StatefulWidget {
  const ManagedRoomScreen({super.key, required this.base});
  final String base;

  @override
  State<ManagedRoomScreen> createState() => _ManagedRoomScreenState();
}

class _ManagedRoomScreenState extends State<ManagedRoomScreen> {
  late final WebViewController hub;
  WebViewController? activity;
  Timer? expiry;
  int generation = 0;
  String? error;

  @override
  void initState() {
    super.initState();
    hub = WebViewController();
    _start();
  }

  Future<void> _start() async {
    final address = Uri.parse('${widget.base}/room/');
    try {
      await hub.setJavaScriptMode(JavaScriptMode.unrestricted);
      await hub.setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (r) => Uri.tryParse(r.url) == address
            ? NavigationDecision.navigate : NavigationDecision.prevent,
        onWebResourceError: (e) {
          if (mounted && e.isForMainFrame == true) setState(() => error = 'Cannot reach Room. Check the connection.');
        },
      ));
      await hub.addJavaScriptChannel('RoomMobile', onMessageReceived: (message) async {
        if (await hub.currentUrl() == address.toString() && mounted) await _policy(message.message);
      });
      await hub.loadRequest(address);
    } catch (_) {
      if (mounted) setState(() => error = 'Unable to open Room.');
    }
  }

  void _finish() {
    generation++;
    expiry?.cancel();
    if (mounted) setState(() => activity = null);
  }

  Future<void> _policy(String message) async {
    final p = jsonDecode(message) as Map<String, dynamic>;
    if (p['finish'] == true) { _finish(); return; }
    final target = Uri.parse(p['url'] as String);
    final origins = Set<String>.from(p['origins'] as List);
    final mode = p['mode'];
    final revision = p['revision'];
    final duration = p['remainingMs'];
    bool allowed(Uri? u) => u != null && u.scheme == 'https' && u.host.isNotEmpty && u.userInfo.isEmpty &&
        (mode == 'open' || origins.contains(u.origin));
    if (!allowed(target) || !{'single', 'selected', 'open'}.contains(mode) ||
        revision is! int || duration is! int || duration <= 0 || duration > 86401000) return;
    final current = ++generation;
    final guest = WebViewController();
    await guest.setJavaScriptMode(JavaScriptMode.unrestricted);
    await guest.setNavigationDelegate(NavigationDelegate(
      onNavigationRequest: (r) => allowed(Uri.tryParse(r.url))
          ? NavigationDecision.navigate : NavigationDecision.prevent,
      onWebResourceError: (e) {
        if (mounted && current == generation && e.isForMainFrame == true) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Activity unavailable. Check the approved site with your host.')));
        }
      },
    ));
    if (!mounted || generation != current) return;
    setState(() => activity = guest);
    expiry?.cancel();
    expiry = Timer(Duration(milliseconds: duration), () {
      _finish();
      hub.runJavaScript('window.roomExpired()');
    });
    await guest.loadRequest(target);
    if (mounted && current == generation) await hub.runJavaScript('window.roomPolicyApplied($revision)');
  }

  @override
  void dispose() { generation++; expiry?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: activity == null,
    child: Scaffold(
      appBar: activity == null ? AppBar(title: const Text('Room')) : null,
      body: SafeArea(child: error != null ? Center(child: Text(error!)) : Column(children: [
        Expanded(flex: activity == null ? 1 : 0, child: SizedBox(
          height: activity == null ? null : 170, child: WebViewWidget(controller: hub))),
        if (activity != null) Expanded(child: WebViewWidget(key: ObjectKey(activity), controller: activity!)),
      ])),
    ),
  );
}
