// swift-tools-version:5.9
// Host-only (macOS) test harness for ios/Core. Sources/PoolseCallCore is a
// symlink to ../../Core — the exact files the iOS pod compiles.
import PackageDescription

let package = Package(
  name: "PoolseCallCore",
  platforms: [.macOS(.v13), .iOS(.v15)],
  products: [.library(name: "PoolseCallCore", targets: ["PoolseCallCore"])],
  targets: [
    .target(name: "PoolseCallCore", path: "Sources/PoolseCallCore", exclude: ["PORTS_READY.md"]),
    .testTarget(name: "PoolseCallCoreTests", dependencies: ["PoolseCallCore"], path: "Tests/PoolseCallCoreTests"),
  ]
)
