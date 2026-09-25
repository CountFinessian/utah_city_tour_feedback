import UIKit
import Capacitor
import WebKit

class MainViewController: CAPBridgeViewController {
    private let darkBg = UIColor(red: 7/255.0, green: 11/255.0, blue: 18/255.0, alpha: 1.0) // #070b12

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = darkBg
        configureEdgeToEdgeWebView()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        view.backgroundColor = darkBg
        configureEdgeToEdgeWebView()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        configureEdgeToEdgeWebView()
    }

    private func configureEdgeToEdgeWebView() {
        view.backgroundColor = darkBg
        if let webView = self.webView {
            webView.backgroundColor = darkBg
            webView.isOpaque = false
            webView.scrollView.backgroundColor = darkBg
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            webView.scrollView.bounces = false
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        let darkBg = UIColor(red: 7/255.0, green: 11/255.0, blue: 18/255.0, alpha: 1.0)
        window?.backgroundColor = darkBg
        window?.overrideUserInterfaceStyle = .dark
        let bridgeVC = MainViewController()
        bridgeVC.view.backgroundColor = darkBg
        window?.rootViewController = bridgeVC
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
