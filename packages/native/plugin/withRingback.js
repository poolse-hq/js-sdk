/**
 * Config plugin: ship the ringback tone — what the caller hears while the
 * other phone rings — in both app bundles.
 *
 * The native core plays it by resource name: `configure({ ringback })`
 * with the file's base name finds the iOS bundle's `<name>.<ext>` and
 * Android's `res/raw/<name>`. Android resource names allow only
 * lowercase letters, digits and underscores, so the file must be named
 * that way.
 *
 * `expo prebuild` regenerates `ios/` and `android/` from scratch, so this
 * re-applies the file every time instead of it being added by hand.
 */
const { withAndroidRawSound, withIosBundleSound } = require('./bundledSound');

const MISSING =
  'Without it the caller hears nothing (Android) or an iPhone ringtone (iOS) while it rings.';

module.exports = function withRingback(config, file) {
  // withAndroidRawSound validates the name before anything is copied.
  config = withAndroidRawSound(config, file, 'ringback', MISSING);
  return withIosBundleSound(config, file, 'ringback', MISSING);
};
