/**
 * Name expo-notifications as the FCM delegate for the
 * native call core.
 *
 * `@poolse/react-native-calls` ships its own FirebaseMessagingService
 * (CallMessagingService) so a ring is handled in native code the instant
 * it arrives — no headless-JS boot race. Android delivers every FCM
 * message to exactly ONE service, so the call core becomes the app's
 * primary intake and forwards everything that is NOT a call to the
 * service named here. Without this meta-data, non-call pushes (chat
 * notifications, token rotations) would be dropped on the floor.
 *
 * The value is expo-notifications' own FirebaseMessagingService, so
 * everything the app already relies on keeps working unchanged.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const META_NAME = 'dev.poolse.callcore.delegate';
const DELEGATE = 'expo.modules.notifications.service.ExpoFirebaseMessagingService';

module.exports = function withCallDelegate(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('withCallDelegate: no <application> in AndroidManifest');

    app['meta-data'] = app['meta-data'] ?? [];
    const existing = app['meta-data'].find((m) => m.$?.['android:name'] === META_NAME);
    if (existing) {
      existing.$['android:value'] = DELEGATE;
    } else {
      app['meta-data'].push({ $: { 'android:name': META_NAME, 'android:value': DELEGATE } });
    }
    return cfg;
  });
};
