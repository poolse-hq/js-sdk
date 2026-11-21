/**
 * `ringtone`: the sound an incoming call rings with, instead of the
 * system ringtone.
 *
 *   "ringtone": "./assets/sounds/ring.wav"
 *   "ringtone": { "ios": "./assets/sounds/ring.caf", "android": "./assets/sounds/ring.ogg" }
 *
 * iOS: CallKit plays it (`CXProviderConfiguration.ringtoneSound`), so it
 * must be caf, aiff or wav and 30 seconds or shorter — iOS rings with the
 * system ringtone otherwise. The file goes into the app bundle and its
 * name into Info.plist `PoolseRingtone`, where the core reads it at a
 * PushKit cold wake, before any JS.
 *
 * Android: the core plays it itself (looping, on the ringtone stream)
 * from `res/raw/<name>`; use a format MediaPlayer reads (ogg, mp3, wav —
 * not caf). The name goes into the application meta-data
 * `dev.poolse.calls.ringtone`. The incoming-call notification channel
 * stays silent, so changing the sound later needs no new channel.
 *
 * Both: lowercase letters, digits and underscores in the file name (an
 * Android resource name), and not the same base name as `ringback`.
 * `configure({ ringtone })` at runtime overrides this; leaving it out
 * there falls back to this one.
 */
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');
const path = require('node:path');

const { ANDROID_NAME, withAndroidRawSound, withIosBundleSound } = require('./bundledSound');

const PLIST_KEY = 'PoolseRingtone';
const META_NAME = 'dev.poolse.calls.ringtone';
const IOS_EXTENSIONS = ['.caf', '.aiff', '.aif', '.wav'];
const MISSING = 'Without it calls ring with the system ringtone.';

function split(option) {
  if (typeof option === 'string') return { ios: option, android: option };
  if (option && typeof option === 'object') return { ios: option.ios, android: option.android };
  throw new Error('@poolse/native: ringtone must be a file path or { ios, android }.');
}

/**
 * One Info.plist and one manifest mod that both clear and set: mods run
 * in reverse order of registration, so a separate "clear" mod registered
 * first would run last and undo the value.
 */
function withRingtoneNames(config, plistValue, metaValue) {
  config = withInfoPlist(config, (cfg) => {
    if (plistValue) cfg.modResults[PLIST_KEY] = plistValue;
    else delete cfg.modResults[PLIST_KEY];
    return cfg;
  });
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('withRingtone: no <application> in AndroidManifest');
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => m.$?.['android:name'] !== META_NAME);
    if (metaValue)
      app['meta-data'].push({ $: { 'android:name': META_NAME, 'android:value': metaValue } });
    return cfg;
  });
}

module.exports = function withRingtone(config, option, ringback) {
  // Without the option this still runs, removing what an earlier prebuild wrote.
  if (!option) return withRingtoneNames(config, null, null);
  const { ios, android } = split(option);
  const ringbackName = ringback ? path.parse(ringback).name : null;

  if (ios) {
    const ext = path.extname(ios).toLowerCase();
    if (!IOS_EXTENSIONS.includes(ext)) {
      throw new Error(
        `@poolse/native: ringtone "${path.basename(ios)}" — CallKit plays only ` +
          `${IOS_EXTENSIONS.join(', ')} (30 s or shorter). Convert it, e.g. ` +
          '`afconvert -f caff -d LEI16 ring.mp3 ring.caf`, or pass { ios, android }.',
      );
    }
    if (!ANDROID_NAME.test(path.parse(ios).name)) {
      throw new Error(
        `@poolse/native: ringtone "${path.basename(ios)}" — use lowercase letters, ` +
          'digits and underscores in the name.',
      );
    }
    config = withIosBundleSound(config, ios, 'ringtone', MISSING);
  }

  if (android) {
    const name = path.parse(android).name;
    if (name === ringbackName) {
      throw new Error(
        `@poolse/native: ringtone and ringback are both "${name}" — Android keeps ` +
          'one res/raw entry per name. Rename one of them.',
      );
    }
    config = withAndroidRawSound(config, android, 'ringtone', MISSING);
  }
  return withRingtoneNames(
    config,
    ios ? path.basename(ios) : null,
    android ? path.parse(android).name : null,
  );
};
