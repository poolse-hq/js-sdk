package dev.poolse.callcore.android

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.util.Log
import java.net.URLEncoder

/**
 * How the full-screen incoming call looks, or which activity replaces it.
 *
 * Each field comes from `configure({ incomingCall })` (persisted) or, when
 * that leaves it out, from the config plugin's `incomingCall` option
 * (application meta-data `dev.poolse.calls.incoming_*`), so a ring that
 * wakes a closed app looks the same before any JS runs.
 */
data class IncomingCallLook(
  /** The glow, the pulsing ring and the initials disc. */
  val accentColor: Int = DEFAULT_ACCENT,
  /** Whether [accentColor] was set by the app (the notification is tinted only then). */
  val accentFromApp: Boolean = false,
  val backgroundColor: Int = DEFAULT_BACKGROUND,
  /**
   * `https://cdn.example.com/avatars/{externalId}.jpg` — `{externalId}`
   * (the caller's id in the app) and `{userId}` (the poolse user id) are
   * filled in, URL-encoded. A push's own `caller_avatar_url` wins.
   */
  val avatarUrlTemplate: String? = null,
  /** Fully qualified class of the app's own ring activity, launched instead of the built-in one. */
  val activityClass: String? = null,
) {
  /** The caller's picture URL from the template, or null when a placeholder it needs is missing. */
  fun avatarUrlFor(externalId: String?, userId: String?): String? {
    val template = avatarUrlTemplate ?: return null
    var url: String = template
    for ((key, value) in listOf("{externalId}" to externalId, "{userId}" to userId)) {
      if (!url.contains(key)) continue
      val v = value?.ifEmpty { null } ?: return null
      url = url.replace(key, URLEncoder.encode(v, "UTF-8").replace("+", "%20"))
    }
    return url.takeIf { it.startsWith("https://") || it.startsWith("http://") }
  }

  /** The app's activity as an explicit intent, or null (unset, or not in the manifest). */
  internal fun customActivityIntent(context: Context): Intent? {
    val name = activityClass ?: return null
    val intent = Intent().setClassName(context.packageName, name)
    if (context.packageManager.resolveActivity(intent, 0) == null) {
      Log.w(TAG, "incomingCall.activity $name is not declared in the manifest — using the built-in screen")
      return null
    }
    return intent
  }

  companion object {
    val DEFAULT_ACCENT = Color.parseColor("#5B54E8")
    val DEFAULT_BACKGROUND = Color.parseColor("#0B0B14")
    private const val TAG = "PoolseIncomingCall"

    internal const val META_ACCENT = "dev.poolse.calls.incoming_accent_color"
    internal const val META_BACKGROUND = "dev.poolse.calls.incoming_background_color"
    internal const val META_AVATAR = "dev.poolse.calls.incoming_avatar_url"
    internal const val META_ACTIVITY = "dev.poolse.calls.incoming_activity"

    /** `#RRGGBB`, `#AARRGGBB` or a colour name; null when unset or unreadable. */
    internal fun parseColor(value: String?): Int? =
      value?.ifEmpty { null }?.let { runCatching { Color.parseColor(it) }.getOrNull() }

    /**
     * aapt stores a meta-data value written as `#RRGGBB` as a colour INT,
     * not the string — read both.
     */
    private fun manifestColor(context: Context, name: String): Int? = runCatching {
      val meta = context.packageManager
        .getApplicationInfo(context.packageName, android.content.pm.PackageManager.GET_META_DATA)
        .metaData ?: return null
      when (val v = meta.get(name)) {
        is Int -> v
        is String -> parseColor(v)
        else -> null
      }
    }.getOrNull()

    /** Runtime values first, then the plugin's meta-data, then the built-in look. */
    internal fun resolve(
      context: Context,
      accentColor: String?,
      backgroundColor: String?,
      avatarUrl: String?,
      activity: String?,
    ): IncomingCallLook {
      fun pick(runtime: String?, meta: String) = runtime?.ifEmpty { null } ?: CallCore.manifestValue(context, meta)
      fun color(runtime: String?, meta: String) = parseColor(runtime) ?: manifestColor(context, meta)
      val accent = color(accentColor, META_ACCENT)
      val activityName = pick(activity, META_ACTIVITY)?.let {
        if (it.startsWith(".")) context.packageName + it else it
      }
      return IncomingCallLook(
        accentColor = accent ?: DEFAULT_ACCENT,
        accentFromApp = accent != null,
        backgroundColor = color(backgroundColor, META_BACKGROUND) ?: DEFAULT_BACKGROUND,
        avatarUrlTemplate = pick(avatarUrl, META_AVATAR),
        activityClass = activityName,
      )
    }
  }
}
