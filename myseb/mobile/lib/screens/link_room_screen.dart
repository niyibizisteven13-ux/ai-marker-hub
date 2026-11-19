import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

class LinkRoomScreen extends StatefulWidget {
  const LinkRoomScreen({super.key, required this.address, this.mode, this.sites = const {}});
  final Uri address;
  final String? mode;
  final Set<String> sites;
  @override
  State<LinkRoomScreen> createState() => _LinkRoomState();
}

class _LinkRoomState extends State<LinkRoomScreen> {
  late final WebViewController controller;
  String? error;

  @override
  void initState() {
    super.initState();
    controller = WebViewController();
    _load();
  }

  Future<void> _load() async {
    try {
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      await controller.setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: _navigate,
        onWebResourceError: (e) {
          if (mounted && e.isForMainFrame == true) setState(() => error = 'Could not load this page. Check your connection and the room settings.');
        },
      ));
      await controller.loadRequest(widget.address);
    } catch (_) {
      if (mounted) setState(() => error = 'Unable to open this page.');
    }
  }

  NavigationDecision _navigate(NavigationRequest request) {
    final uri = Uri.tryParse(request.url);
    if (uri == null) return NavigationDecision.prevent;
    if (!request.isMainFrame) return NavigationDecision.navigate;
    if (widget.mode != null) {
      if (uri.scheme == 'https' && uri.host.isNotEmpty && uri.userInfo.isEmpty &&
          (widget.mode == 'open' || widget.sites.contains(uri.origin))) return NavigationDecision.navigate;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('This link is outside the room settings.')));
      return NavigationDecision.prevent;
    }
    if (uri.replace(fragment: '') == widget.address.replace(fragment: '')) return NavigationDecision.navigate;
    if (uri.scheme != widget.address.scheme || uri.authority != widget.address.authority ||
        uri.path != widget.address.resolve('launch').path) return NavigationDecision.prevent;
    try {
      final args = Uri.splitQueryString(uri.fragment);
      final target = Uri.parse(args['target']!);
      final mode = args['mode'];
      if (target.scheme != 'https' || target.host.isEmpty || target.userInfo.isNotEmpty ||
          !{'single', 'selected', 'open'}.contains(mode)) return NavigationDecision.prevent;
      final sites = <String>{target.origin};
      if (mode == 'selected') sites.addAll((jsonDecode(args['sites']!) as List).cast<String>());
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => LinkRoomScreen(address: target, mode: mode, sites: sites)));
    } on FormatException { return NavigationDecision.prevent; }
    return NavigationDecision.prevent;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(widget.mode == null ? 'MySEB LiveRoom' : widget.address.host)),
    body: error == null ? WebViewWidget(controller: controller) : Center(child: Text(error!)),
  );
}
