//
//  ViewController.swift
//  Shared (App)
//
//  Created by Brandon McConnell on 9/8/26.
//

import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

private let extensionBundleIdentifier = "sh.geld.safari.Extension"

private enum AppAction: String {
    case openPreferences = "open-preferences"
    case openDemo = "open-demo"
    case openHelp = "open-help"
    case openPrivacy = "open-privacy"
}

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    private var pageIsReady = false

#if os(macOS)
    private var activationObserver: NSObjectProtocol?
#endif

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

#if os(iOS)
        self.webView.scrollView.isScrollEnabled = false
#elseif os(macOS)
        // The page follows the window's content when `fitWindowToScreen` makes it shorter than the storyboard's.
        self.webView.translatesAutoresizingMaskIntoConstraints = true
        self.webView.autoresizingMask = [.width, .height]
        self.webView.frame = self.view.bounds
#endif

        self.webView.configuration.userContentController.add(self, name: "controller")

        guard let pageURL = Bundle.main.url(forResource: "Main", withExtension: "html") else {
            return
        }
        self.webView.loadFileURL(pageURL, allowingReadAccessTo: Bundle.main.resourceURL!)

#if os(macOS)
        activationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.refreshExtensionState()
        }
#endif
    }

#if os(macOS)
    override func viewDidAppear() {
        super.viewDidAppear()
        fitWindowToScreen()
    }

    /// The window opens 780 points tall and cannot be resized, so on a short screen (a 1280×800 display) it would run
    /// past the bottom: it is made as tall as the screen shows instead, and the page scrolls.
    private func fitWindowToScreen() {
        guard let window = self.view.window, let screen = window.screen ?? NSScreen.main else {
            return
        }
        let visible = screen.visibleFrame
        var frame = window.frame
        guard frame.height > visible.height else {
            return
        }
        frame.size.height = visible.height
        frame.origin.y = visible.minY
        window.setFrame(frame, display: true)
    }
#endif

    deinit {
#if os(macOS)
        if let activationObserver {
            NotificationCenter.default.removeObserver(activationObserver)
        }
#endif
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageIsReady = true
        refreshExtensionState()
    }

    private func refreshExtensionState() {
        guard pageIsReady else {
            return
        }

#if os(iOS)
        webView.evaluateJavaScript("show('ios')")
#elseif os(macOS)
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard error == nil, let state else {
                DispatchQueue.main.async {
                    self.webView.evaluateJavaScript("show('mac')")
                }
                return
            }

            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("show('mac', \(state.isEnabled))")
            }
        }
#endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            let actionName = message.body as? String,
            let action = AppAction(rawValue: actionName)
        else {
            return
        }

        switch action {
#if os(macOS)
        case .openPreferences:
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in }
#else
        case .openPreferences:
            break
#endif
        case .openDemo:
            openDemoPullRequest()
        case .openHelp:
            openExternalURL("https://www.geld.sh/how-it-works")
        case .openPrivacy:
            openExternalURL("https://www.geld.sh/privacy")
        }
    }

    private func openDemoPullRequest() {
        let address = "https://github.com/wxt-dev/wxt/pull/2544/files"
        guard let url = URL(string: address) else {
            return
        }

#if os(macOS)
        SFSafariApplication.openWindow(with: url) { _ in }
#elseif os(iOS)
        UIApplication.shared.open(url)
#endif
    }

    private func openExternalURL(_ address: String) {
        guard let url = URL(string: address) else {
            return
        }

#if os(macOS)
        NSWorkspace.shared.open(url)
#elseif os(iOS)
        UIApplication.shared.open(url)
#endif
    }
}
