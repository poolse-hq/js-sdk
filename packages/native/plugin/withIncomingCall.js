/**
 * `incomingCall` (Android): how the full-screen incoming call looks, or
 * the app's own activity to launch instead.
 *
 *   "incomingCall": {
 *     "accentColor": "#FF5A1F",
 *     "backgroundColor": "#101014",
 *     "avatarUrl": "https://cdn.example.com/avatars/{externalId}.jpg",
 *     "activity": ".RingActivity"
 *   }
 *
 * Written as application meta-data (`dev.poolse.calls.incoming_*`), which
 * the core reads when a ring wakes a closed app — before any JS, so the
 * screen looks right on the very first ring. `configure({ incomingCall })`
 * overrides each field at runtime. iOS ignores it: CallKit draws the call
 * screen there.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const META = {
  accentColor: 'dev.poolse.calls.incoming_accent_color',
  backgroundColor: 'dev.poolse.calls.incoming_background_color',
  avatarUrl: 'dev.poolse.calls.incoming_avatar_url',
  activity: 'dev.poolse.calls.incoming_activity',
};

const COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CLASS_NAME = /^\.?[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

function validate(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('@poolse/native: incomingCall must be an object.');
  }
  for (const key of Object.keys(options)) {
    if (!(key in META)) {
      throw new Error(
        `@poolse/native: incomingCall.${key} is not an option (${Object.keys(META).join(', ')}).`,
      );
    }
  }
  for (const key of ['accentColor', 'backgroundColor']) {
    if (options[key] != null && !COLOR.test(options[key])) {
      throw new Error(
        `@poolse/native: incomingCall.${key} "${options[key]}" — use #RRGGBB or #AARRGGBB.`,
      );
    }
  }
  if (options.avatarUrl != null && !/^https?:\/\//.test(options.avatarUrl)) {
    throw new Error('@poolse/native: incomingCall.avatarUrl must be an http(s) URL template.');
  }
  if (options.activity != null && !CLASS_NAME.test(options.activity)) {
    throw new Error(
      `@poolse/native: incomingCall.activity "${options.activity}" — a class name such as ` +
        '"com.example.app.RingActivity" or ".RingActivity".',
    );
  }
}

module.exports = function withIncomingCall(config, options) {
  validate(options);
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('withIncomingCall: no <application> in AndroidManifest');
    const names = new Set(Object.values(META));
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => !names.has(m.$?.['android:name']));
    for (const [key, name] of Object.entries(META)) {
      const value = options[key];
      if (value != null && value !== '') {
        app['meta-data'].push({ $: { 'android:name': name, 'android:value': String(value) } });
      }
    }
    return cfg;
  });
};
