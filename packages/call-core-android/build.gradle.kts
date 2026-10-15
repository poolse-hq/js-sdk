// The pure call core: the contract's state machine and its ports.
// Deliberately a plain Kotlin JVM module — no Android, no React Native,
// no network — so the conformance vectors run as fast unit tests on any
// machine. Android-specific adapters (ring surface, LiveKit, HTTP,
// foreground service) implement the ports from the bridge package.
plugins {
  kotlin("jvm") version "2.1.0"
}

repositories { mavenCentral() }

dependencies {
  testImplementation(kotlin("test"))
  testImplementation("com.google.code.gson:gson:2.11.0")
}

tasks.test {
  useJUnitPlatform()
  // The vectors are the contract's property, not this module's — but
  // they ARE this task's input: editing the contract must re-run the
  // suite, or the conformance mechanism is decorative.
  val vectors = rootDir.resolve("../../contracts/call-core/vectors.json")
  inputs.file(vectors).withPathSensitivity(PathSensitivity.NONE)
  systemProperty("poolse.vectors", vectors.canonicalPath)
  testLogging { events("failed"); showStandardStreams = false }
}
