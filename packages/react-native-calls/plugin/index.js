/**
 * The config plugin for @poolse/react-native-calls — everything the
 * native core needs from the app's generated projects, in one entry:
 *
 *   "plugins": [
 *     "expo-notifications",
 *     ["@poolse/react-native-calls", { "ringback": "./assets/sounds/ringback.mp3" }]
 *   ]
 *
 * Options (all optional):
 *   ringback          a sound file shipped in both bundles under its base
 *                     name; pass that name to configure({ ringback }).
 *                     Without one the caller hears silence while it rings.
 *   pictureInPicture  Android: let the activity float during a video call
 *                     (default true).
 *   lockscreen        Android: show the app over the lock screen when it
 *                     is opened for a call (default true).
 *
 * Always applied on Android: the LiveKit media adapter and expo-notifications
 * as the FCM delegate for pushes that are not calls.
 */
const { createRunOncePlugin } = require('expo/config-plugins');

const withCallDelegate = require('./withCallDelegate');
const withLockscreenCalls = require('./withLockscreenCalls');
const withNativeCallMedia = require('./withNativeCallMedia');
const withPictureInPicture = require('./withPictureInPicture');
const withRingback = require('./withRingback');

const pkg = require('../package.json');

function withPoolseCalls(config, options = {}) {
  const { ringback, pictureInPicture = true, lockscreen = true } = options ?? {};
  config = withNativeCallMedia(config);
  config = withCallDelegate(config);
  if (lockscreen) config = withLockscreenCalls(config);
  if (pictureInPicture) config = withPictureInPicture(config);
  if (ringback) config = withRingback(config, ringback);
  return config;
}

module.exports = createRunOncePlugin(withPoolseCalls, pkg.name, pkg.version);
