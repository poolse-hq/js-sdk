package dev.poolse.callcore.android

import android.animation.ValueAnimator
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import dev.poolse.callcore.RingContext
import dev.poolse.callcore.android.AndroidRingSurface.Companion.ACTION_RING_CLOSED
import dev.poolse.callcore.android.AndroidRingSurface.Companion.EXTRA_CALL_ID
import dev.poolse.callcore.android.AndroidRingSurface.Companion.EXTRA_RING

/**
 * The full-screen ring a locked phone shows. Native and dependency-free
 * so it is on screen within the OS's full-screen-intent budget, long
 * before any JS could load — carrying the call scene's look (dark
 * ground, brand glow, a breathing ring) in plain views. The buttons
 * resolve into [CallCore], the same entry point every other surface
 * uses; answering brings the app forward over the keyguard.
 *
 * It closes itself when the ring ends anywhere else (caller cancelled,
 * answered on another device, deadline) via the package-local
 * [ACTION_RING_CLOSED] broadcast — before, a remotely-ended ring left
 * this screen up with dead buttons.
 */
class IncomingCallActivity : Activity() {

  private var pulse: ValueAnimator? = null
  private val density by lazy { resources.displayMetrics.density }
  private fun px(v: Int): Int = (v * density).toInt()
  private val main = Handler(Looper.getMainLooper())

  /** The ring on screen. */
  private var ring: RingContext? = null

  /**
   * Answered: we are only waiting for the app to come forward over us.
   * Our own DISMISS_RING broadcast must not close us before it does —
   * finishing first left the app behind the keyguard.
   */
  private var awaitingForward = false

  private val ringClosed = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val callId = intent.getStringExtra(EXTRA_CALL_ID) ?: return
      if (callId == ring?.callId && !awaitingForward) finish()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverKeyguard()
    ContextCompat.registerReceiver(
      this,
      ringClosed,
      IntentFilter(ACTION_RING_CLOSED),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    handle(intent)
  }

  /** singleInstance: a new ring (or the answer action) arrives here, not in onCreate. */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handle(intent)
  }

  private fun handle(intent: Intent) {
    val next = intent.getBundleExtra(EXTRA_RING)?.toRingContext()
    if (next == null) { if (ring == null) finish(); return }
    val core = CallCore.getOrNull(this)
    if (core == null) { finish(); return }

    // Answered from the notification: this activity exists only to be the
    // foreground context that is ALLOWED to bring the app up (a
    // background receiver is not).
    if (intent.getBooleanExtra(AndroidRingSurface.EXTRA_AUTO_ANSWER, false)) {
      ring = next
      answerAndForward(core, next)
      return
    }

    // A stale tap (the ring resolved, or the process restarted after it
    // ended): there is nothing to answer.
    if (!core.isRingLive(next)) {
      if (ring == null || ring?.callId == next.callId) finish()
      return
    }
    ring = next
    awaitingForward = false
    pulse?.cancel()
    val title = next.conversationName ?: next.callerName ?: "Incoming call"
    val body = if (next.media == "video") "Incoming video call" else "Incoming call"
    setContentView(buildScene(title, body, next))
  }

  /**
   * Answer, then bring the app forward FROM THIS ACTIVITY, and stay
   * (as a plain dark window) until the app is in front — finishing at
   * once dropped the start on some OEMs and left the call audible
   * behind the lock screen. onStop (we got covered) finishes us; a
   * timer is the fallback.
   */
  private fun answerAndForward(core: CallCore, ring: RingContext) {
    awaitingForward = true
    pulse?.cancel()
    pulse = null
    setContentView(View(this).apply { setBackgroundColor(Color.parseColor("#0B0B14")) })
    val launched = core.onUserAnswer(ring, this)
    if (!launched) { finish(); return }
    main.postDelayed({ if (!isFinishing) finish() }, FORWARD_FALLBACK_MS)
  }

  override fun onStop() {
    super.onStop()
    if (awaitingForward && !isFinishing) finish()
  }

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    runCatching { unregisterReceiver(ringClosed) }
    pulse?.cancel()
    pulse = null
    super.onDestroy()
  }

  private companion object {
    const val FORWARD_FALLBACK_MS = 4_000L
  }

  private fun showOverKeyguard() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun buildScene(title: String, body: String, ring: RingContext): View {
    val root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#0B0B14")) }

    root.addView(
      View(this).apply {
        background = GradientDrawable(
          GradientDrawable.Orientation.TOP_BOTTOM,
          intArrayOf(Color.parseColor("#875B54E8"), Color.parseColor("#000B0B14")),
        ).apply {
          gradientType = GradientDrawable.RADIAL_GRADIENT
          gradientRadius = 560 * density
          setGradientCenter(0.5f, 0.3f)
        }
      },
      FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT,
    )

    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(px(32), px(110), px(32), px(72))
    }

    val stage = FrameLayout(this).apply {
      layoutParams = LinearLayout.LayoutParams(px(176), px(176)).apply { bottomMargin = px(30) }
    }
    val ringView = View(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.TRANSPARENT)
        setStroke(px(2), Color.parseColor("#805B54E8"))
      }
    }
    stage.addView(ringView, FrameLayout.LayoutParams(px(176), px(176), Gravity.CENTER))
    stage.addView(
      TextView(this).apply {
        text = title.trim().take(1).uppercase()
        textSize = 48f
        setTextColor(Color.WHITE)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        gravity = Gravity.CENTER
        background = GradientDrawable(
          GradientDrawable.Orientation.TL_BR,
          intArrayOf(Color.parseColor("#7D76FF"), Color.parseColor("#5B54E8")),
        ).apply { shape = GradientDrawable.OVAL }
      },
      FrameLayout.LayoutParams(px(124), px(124), Gravity.CENTER),
    )

    val name = TextView(this).apply {
      text = title
      textSize = 32f
      setTextColor(Color.WHITE)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      gravity = Gravity.CENTER
    }
    val sub = TextView(this).apply {
      text = body
      textSize = 15f
      setTextColor(Color.parseColor("#B8B8C6"))
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        cornerRadius = 999f
        setColor(Color.parseColor("#14FFFFFF"))
      }
      setPadding(px(16), px(8), px(16), px(8))
      layoutParams = LinearLayout.LayoutParams(wrap(), wrap()).apply { topMargin = px(12) }
    }

    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, wrap())
    }
    val decline = actionButton("Decline", "✕", "#EF4444") {
      CallCore.getOrNull(this)?.onUserDecline(ring); finish()
    }
    val accept = actionButton("Answer", "✓", "#22C55E") {
      val core = CallCore.getOrNull(this)
      if (core == null) finish() else answerAndForward(core, ring)
    }
    buttons.addView(decline, LinearLayout.LayoutParams(wrap(), wrap()).apply { rightMargin = px(52) })
    buttons.addView(accept, LinearLayout.LayoutParams(wrap(), wrap()).apply { leftMargin = px(52) })

    column.addView(stage)
    column.addView(name)
    column.addView(sub)
    column.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(0, 0, 1f) })
    column.addView(buttons)
    root.addView(
      column,
      FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT),
    )

    pulse = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 1800
      repeatCount = ValueAnimator.INFINITE
      interpolator = LinearInterpolator()
      addUpdateListener {
        val t = it.animatedValue as Float
        ringView.scaleX = 1f + 0.28f * t
        ringView.scaleY = 1f + 0.28f * t
        ringView.alpha = 1f - t
      }
      start()
    }
    return root
  }

  private fun actionButton(
    label: String,
    glyph: String,
    color: String,
    onClick: () -> Unit,
  ): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER_HORIZONTAL
    addView(
      TextView(this@IncomingCallActivity).apply {
        text = glyph
        textSize = 30f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        background = GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(Color.parseColor(color))
        }
        layoutParams = LinearLayout.LayoutParams(px(82), px(82))
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
      },
    )
    addView(
      TextView(this@IncomingCallActivity).apply {
        text = label
        textSize = 14f
        setTextColor(Color.parseColor("#B8B8C6"))
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(wrap(), wrap()).apply { topMargin = px(10) }
      },
    )
  }

  private fun wrap() = LinearLayout.LayoutParams.WRAP_CONTENT
}
