import Flutter
import UIKit

/// Native lock layer for MySEB (iOS).
///  - UIScreen.capturedDidChangeNotification: screen recording / mirroring / AirPlay starts -> cover the screen + tell Dart.
///  - UIApplication.userDidTakeScreenshotNotification: a screenshot was taken -> tell Dart (iOS cannot block it, only detect it).
///  - The app-switcher snapshot is covered whenever the app becomes inactive.
///  - UIAccessibility.requestGuidedAccessSession: asks iOS to enter Guided Access (home button / swipe-up / notifications locked).
///    iOS only allows an app to do this when the device is supervised and the app is allowed to by an MDM Single-App-Mode
///    profile; otherwise the request is refused and the student must triple-click the side button to start Guided Access by hand.
@main
@objc class AppDelegate: FlutterAppDelegate {
    private var channel: FlutterMethodChannel?
    private var cover: UIView?
    private var examActive = false

    override func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        GeneratedPluginRegistrant.register(with: self)
        if let controller = window?.rootViewController as? FlutterViewController {
            channel = FlutterMethodChannel(name: "myseb/lock", binaryMessenger: controller.binaryMessenger)
            channel?.setMethodCallHandler { [weak self] call, result in
                guard let self = self else { return }
                switch call.method {
                case "lock":
                    self.examActive = true
                    self.requestGuidedAccess(true)
                    if UIScreen.main.isCaptured { self.showCover(); self.emit("screen_recording") }
                    result(UIAccessibility.isGuidedAccessEnabled)
                case "unlock":
                    self.examActive = false
                    self.requestGuidedAccess(false)
                    self.hideCover()
                    result(true)
                default: result(FlutterMethodNotImplemented)
                }
            }
        }

        NotificationCenter.default.addObserver(forName: UIScreen.capturedDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self, self.examActive else { return }
            if UIScreen.main.isCaptured { self.showCover(); self.emit("screen_recording") } else { self.hideCover() }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.userDidTakeScreenshotNotification, object: nil, queue: .main) { [weak self] _ in
            self?.emit("screenshot")
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            if self?.examActive == true { self?.showCover() }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            if !UIScreen.main.isCaptured { self?.hideCover() }
        }
        return super.application(application, didFinishLaunchingWithOptions: launchOptions)
    }

    private func emit(_ event: String) { if examActive { channel?.invokeMethod("event", arguments: event) } }

    private func requestGuidedAccess(_ on: Bool) {
        UIAccessibility.requestGuidedAccessSession(enabled: on) { [weak self] ok in
            if on && !ok { self?.emit("guided_access_denied") }
        }
    }

    private func showCover() {
        guard cover == nil, let win = window else { return }
        let v = UIView(frame: win.bounds)
        v.backgroundColor = UIColor(red: 0.06, green: 0.09, blue: 0.16, alpha: 1)
        let label = UILabel(frame: v.bounds)
        label.text = "MySEB"; label.textAlignment = .center; label.textColor = .white
        label.font = .boldSystemFont(ofSize: 34); label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.addSubview(label); v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        win.addSubview(v); cover = v
    }

    private func hideCover() { cover?.removeFromSuperview(); cover = nil }
}
