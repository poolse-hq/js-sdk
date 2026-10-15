package dev.poolse.callcore.android

import android.animation.ValueAnimator
import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import dev.poolse.callcore.android.AndroidRingSurface.Companion.EXTRA_RING

/**
 * The full-screen ring a locked phone shows. Native and dependency-free
 * so it is on screen within the OS's full-screen-intent budget, long
 * before any JS could load — carrying the call scene's look (dark
 * ground, brand glow, a breathing ring) in plain views. The buttons
 * resolve into [CallCore], the same entry point every other surface
 * uses; answering brings the app forward over the keyguard.
 */
class IncomingCallActivity : Activity() {

  private var pulse: ValueAnimator? = null
  private val density by lazy { resources.displayMetrics.density }
  private fun px(v: Int): Int = (v * density).toInt()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverKeyguard()

    val ring = intent.getBundleExtra(EXTRA_RING)?.toRingContext()
    if (ring == null) { finish(); return }

    val title = ring.conversationName ?: ring.callerName ?: "Incoming call"
    val body = if (ring.media == "video") "Incoming video call" else "Incoming call"
    setContentView(buildScene(title, body, ring))
  }

  override fun onDestroy() {
    pulse?.cancel()
    pulse = null
    super.onDestroy()
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

  private fun buildScene(title: String, body: String, ring: dev.poolse.callcore.RingContext): View {
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
      CallCore.get(this).onUserDecline(ring); finish()
    }
    val accept = actionButton("Answer", "✓", "#22C55E") {
      CallCore.get(this).onUserAnswer(ring); finish()
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
