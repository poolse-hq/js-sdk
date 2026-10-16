// The Android half of @poolse/react-native-calls.
//
// Two source sets: the core adapters (`src/main/java`) depend only on
// AndroidX, OkHttp and Firebase Messaging and are always built; the
// LiveKit media adapter (`src/main/livekit`) is included only when the
// `poolse.livekit` property is set, so the library compiles without an
// SFU SDK on the classpath and the SFU stays swappable.
plugins {
  id("com.android.library")
  kotlin("android")
}

val useLiveKit = project.hasProperty("poolse.livekit")

android {
  namespace = "dev.poolse.callcore"
  compileSdk = 35

  defaultConfig {
    minSdk = 24
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }

  sourceSets {
    getByName("main") {
      if (useLiveKit) java.srcDir("src/main/livekit/java")
    }
  }
}

// The Expo bridge (expo/modules/poolsecalls) needs expo-modules-core,
// which only the app's Expo autolinking wires in. This standalone build
// exists to verify the core and the Android adapters, so it excludes
// the bridge from compilation; the app build compiles it.
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
  exclude("**/expo/modules/poolsecalls/**")
}

repositories {
  google()
  mavenCentral()
}

dependencies {
  implementation("androidx.core:core-ktx:1.13.1")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("com.google.firebase:firebase-messaging:24.0.3")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

  if (useLiveKit) {
    implementation("io.livekit:livekit-android:2.11.0")
  }
}
