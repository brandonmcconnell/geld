//
//  AppDelegate.swift
//  macOS (App)
//
//  Created by Brandon McConnell on 9/8/26.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Override point for customization after application launch.
    }

    @IBAction func showGeldHelp(_ sender: Any?) {
        guard let url = URL(string: "https://www.geld.sh/how-it-works") else {
            return
        }
        NSWorkspace.shared.open(url)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

}
