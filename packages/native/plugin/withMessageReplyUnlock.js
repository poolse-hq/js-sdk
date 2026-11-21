/**
 * `messageReplyRequiresUnlock`: make a chat notification's Reply ask for
 * the passcode / Face ID / fingerprint before it sends, so nobody can
 * answer as the user from a locked phone. Off by default — replying from
 * the lock screen is what WhatsApp and Messages do. Mark as read never
 * asks.
 *
 * iOS: `PoolseMessageReplyRequiresUnlock` in Info.plist — the core then
 * registers the Reply action with `.authenticationRequired`.
 * Android: application meta-data `dev.poolse.messages.reply_requires_unlock`
 * — the core marks the Reply action `setAuthenticationRequired` (Android
 * 12+; older versions ignore it).
 */
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const PLIST_KEY = 'PoolseMessageReplyRequiresUnlock';
const META_NAME = 'dev.poolse.messages.reply_requires_unlock';

module.exports = function withMessageReplyUnlock(config, required) {
  const on = required === true;
  config = withInfoPlist(config, (cfg) => {
    if (on) cfg.modResults[PLIST_KEY] = true;
    else delete cfg.modResults[PLIST_KEY];
    return cfg;
  });
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('withMessageReplyUnlock: no <application> in AndroidManifest');
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => m.$?.['android:name'] !== META_NAME);
    if (on) app['meta-data'].push({ $: { 'android:name': META_NAME, 'android:value': 'true' } });
    return cfg;
  });
};
