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
