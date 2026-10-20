# Applied to the HOST app's minified release build.

# CallCore loads the LiveKit MediaPort reflectively
# (Class.forName("dev.poolse.callcore.livekit.LiveKitMediaPort") and its
# Companion.getFactory), so R8 cannot see the reference: keep it whole.
-keep class dev.poolse.callcore.livekit.** { *; }

# The core's entry points are named in the manifest / by the Expo
# module registry; keep them (and their companions) un-renamed too.
-keep class dev.poolse.callcore.android.** { *; }
-keep class expo.modules.poolsecalls.** { *; }
