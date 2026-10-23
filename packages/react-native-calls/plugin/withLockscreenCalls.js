/**
 * Let MainActivity show itself over the keyguard when
 * it is being launched for a call.
 *
 * Two signals ask for it, both from @poolse/react-native-calls:
 *   * the `poolse_launch_call` extra the call core puts on the intent
 *     whenever it brings the app forward — answering from the lock
 *     screen or the notification;
 *   * `CallLockscreen.showOverKeyguard`, set by setShowOnLockscreen
 *     while a call is live, so an activity recreated mid-call keeps it.
 *
 * The expo-modules lifecycle listener is the polite way to do this, but
 * its registration rides autolinking's generated package list, which
 * proved cache-sensitive — a build where it is missing silently
 * reintroduces "unlock to answer". So this patches the generated
 * MainActivity directly, which no cache can skip.
 *
 * Both onCreate AND onNewIntent: MainActivity is singleTask, so a call
 * answered while the app is already running arrives as a new intent on
 * the existing activity, never through onCreate. Checking only onCreate
 * left the app behind the lock screen with the audio already flowing.
 *
 * Only show-when-locked, never dismiss-keyguard: dismissing a secure
 * lock would throw up the PIN bouncer, and a call must not demand an
 * unlock. JS clears the flag when the call ends (setShowOnLockscreen).
 */
const { withMainActivity } = require('expo/config-plugins');

const MARKER = 'poolse_launch_call';

const ON_CREATE_SNIPPET = `
    // Launched for a call: show over the lock screen — answering must
    // never demand an unlock. (See @poolse/react-native-calls/plugin.)
    showOverKeyguardIfCall(intent)
`;

const MEMBERS_SNIPPET = `
  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    showOverKeyguardIfCall(intent)
  }

  private fun showOverKeyguardIfCall(intent: android.content.Intent?) {
    val forCall = expo.modules.poolsecalls.CallLockscreen.showOverKeyguard ||
      intent?.hasExtra("${MARKER}") == true
    if (forCall && android.os.Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
  }
`;

// The block the previous version of this plugin injected; replaced on
// rebuild of an already-patched MainActivity.
const LEGACY_BLOCK =
  /\n\s*\/\/ Launched for a call: show over the lock screen[\s\S]*?setTurnScreenOn\(true\)\n\s*\}\n\s*\}\n/;

module.exports = function withLockscreenCalls(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;

    src = src.replace(LEGACY_BLOCK, '\n');

    const onCreateAnchor = /super\.onCreate\(null\)\n/;
    if (!onCreateAnchor.test(src)) {
      throw new Error('withLockscreenCalls: could not find super.onCreate(null) in MainActivity');
    }
    src = src.replace(onCreateAnchor, (m) => m + ON_CREATE_SNIPPET);

    // Before getMainComponentName's doc comment, so that comment stays
    // attached to its function; the bare declaration is the fallback.
    const memberAnchor =
      /\n  \/\*\*\n   \* Returns the name of the main component|\n  override fun getMainComponentName\(\)/;
    if (!memberAnchor.test(src)) {
      throw new Error('withLockscreenCalls: could not find getMainComponentName in MainActivity');
    }
    src = src.replace(memberAnchor, (m) => MEMBERS_SNIPPET + m);

    cfg.modResults.contents = src;
    return cfg;
  });
};
