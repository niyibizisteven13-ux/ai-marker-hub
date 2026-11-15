import 'package:flutter/material.dart';
import 'screens/start_screen.dart';
import 'services/lock.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  Lock.init();
  runApp(const MySebApp());
}

class MySebApp extends StatelessWidget {
  const MySebApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'MySEB',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB), brightness: Brightness.dark),
          scaffoldBackgroundColor: const Color(0xFF0F172A),
          useMaterial3: true,
        ),
        home: const StartScreen(),
      );
}
