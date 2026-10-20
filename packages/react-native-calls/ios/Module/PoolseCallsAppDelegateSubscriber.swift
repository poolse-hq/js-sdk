import ExpoModulesCore
import UIKit

/// Registers PushKit at launch, before React Native starts — the only
/// point early enough for a VoIP push that cold-launches a killed app.
/// Registered via expo-module.config.json "appDelegateSubscribers", so an
/// Expo host (AppDelegate: ExpoAppDelegate) needs no AppDelegate edit.
public class PoolseCallsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    PoolseCallsSetup.registerVoipEarly()
    return true
  }
}
