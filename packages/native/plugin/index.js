/**
 * The config plugin for @poolse/native — everything the
 * native core needs from the app's generated projects, in one entry:
 *
 *   "plugins": [
 *     "expo-notifications",
 *     ["@poolse/native", { "ringback": "./assets/sounds/ringback.mp3" }]
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
 *   screenShare       iOS: add the broadcast upload extension that sharing
 *                     the screen needs (default false). `true`, or
 *                     `{ appGroup }` to use your own app group instead of
 *                     `group.<bundle id>`. Android needs nothing extra.
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
const withScreenShare = require('./withScreenShare');

const pkg = require('../package.json');

function withPoolseCalls(config, options = {}) {
  const {
    ringback,
    pictureInPicture = true,
    lockscreen = true,
    screenShare = false,
  } = options ?? {};
  config = withNativeCallMedia(config);
  config = withCallDelegate(config);
  if (lockscreen) config = withLockscreenCalls(config);
  if (pictureInPicture) config = withPictureInPicture(config);
  if (ringback) config = withRingback(config, ringback);
  if (screenShare) config = withScreenShare(config, screenShare === true ? {} : screenShare);
  return config;
}

module.exports = createRunOncePlugin(withPoolseCalls, pkg.name, pkg.version);
