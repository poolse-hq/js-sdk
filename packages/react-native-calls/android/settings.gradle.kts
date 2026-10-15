pluginManagement {
  repositories { google(); mavenCentral(); gradlePluginPortal() }
  plugins {
    id("com.android.library") version "8.7.2"
    kotlin("android") version "2.0.21"
  }
}
dependencyResolutionManagement {
  repositories { google(); mavenCentral() }
}
rootProject.name = "react-native-calls"
