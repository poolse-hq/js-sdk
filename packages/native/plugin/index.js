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
 *   ringtone          the incoming-call ring: a file path, or
 *                     { ios, android } (iOS caf/aiff/wav ≤ 30 s; Android
 *                     ogg/mp3/wav). Default: the system ringtone.
 *   incomingCall      Android: the full-screen ring's { accentColor,
 *                     backgroundColor, avatarUrl } or { activity } — your
 *                     own Activity to launch instead (see the README).
 *   pictureInPicture  Android: let the activity float during a video call
 *                     (default true).
 *   lockscreen        Android: show the app over the lock screen when it
 *                     is opened for a call (default true).
 *   screenShare       iOS: add the broadcast upload extension that sharing
 *                     the screen needs (default false). `true`, or
 *                     `{ appGroup }` to use your own app group instead of
 *                     `group.<bundle id>`. Android needs nothing extra.
 *   messageReplyRequiresUnlock
 *                     both: a chat notification's Reply asks for the
 *                     passcode / biometrics first (default false: Reply
 *                     works straight from the lock screen).
 *
 * Always applied on Android: the LiveKit media adapter and expo-notifications
 * as the FCM delegate for pushes that are not calls.
 */
const { createRunOncePlugin } = require('expo/config-plugins');

const withCallDelegate = require('./withCallDelegate');
const withIncomingCall = require('./withIncomingCall');
const withLockscreenCalls = require('./withLockscreenCalls');
const withMessageReplyUnlock = require('./withMessageReplyUnlock');
const withNativeCallMedia = require('./withNativeCallMedia');
const withPictureInPicture = require('./withPictureInPicture');
const withRingback = require('./withRingback');
const withRingtone = require('./withRingtone');
const withScreenShare = require('./withScreenShare');

const pkg = require('../package.json');

function withPoolseCalls(config, options = {}) {
  const {
    ringback,
    ringtone,
    incomingCall,
    pictureInPicture = true,
    lockscreen = true,
    screenShare = false,
    messageReplyRequiresUnlock = false,
  } = options ?? {};
  config = withNativeCallMedia(config);
  config = withCallDelegate(config);
  if (lockscreen) config = withLockscreenCalls(config);
  if (pictureInPicture) config = withPictureInPicture(config);
  if (ringback) config = withRingback(config, ringback);
  // Always applied: without the option they remove what an earlier
  // prebuild wrote, so dropping it really goes back to the defaults.
  config = withRingtone(config, ringtone, ringback);
  config = withIncomingCall(config, incomingCall ?? {});
  config = withMessageReplyUnlock(config, messageReplyRequiresUnlock);
  if (screenShare) config = withScreenShare(config, screenShare === true ? {} : screenShare);
  return config;
}

module.exports = createRunOncePlugin(withPoolseCalls, pkg.name, pkg.version);
