/**
 * iOS screen sharing: a Broadcast Upload Extension next to the app.
 *
 * iOS only lets an app capture the whole screen (not just itself)
 * through a broadcast extension — a separate process the system starts
 * when the user taps Start Broadcast. LiveKit ships the extension's
 * whole implementation (`LKSampleHandler`); it hands frames to the app
 * over a socket in an app group container both sides can reach, and the
 * app publishes them as the screen track.
 *
 * So this adds:
 *   - the extension target `PoolseBroadcast` (bundle id `<app>.broadcast`,
 *     which is what LiveKit looks for), with a one-line SampleHandler,
 *   - the app group `group.<app>` on both the app and the extension,
 *   - a Podfile target linking LiveKit into the extension.
 *
 * The extension is signed like the app: with automatic signing Xcode
 * registers the extension's id and the app group itself; with manual
 * signing both need a provisioning profile that includes the group.
 */
const fs = require('fs');
const path = require('path');
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

const TARGET = 'PoolseBroadcast';

function ids(config, options) {
  const bundleId = config.ios?.bundleIdentifier;
  if (!bundleId) throw new Error('@poolse/native screenShare: set ios.bundleIdentifier');
  return {
    bundleId,
    extensionId: `${bundleId}.broadcast`,
    appGroup: options.appGroup ?? `group.${bundleId}`,
  };
}

function withAppGroup(config, appGroup) {
  return withEntitlementsPlist(config, (c) => {
    const key = 'com.apple.security.application-groups';
    const groups = new Set(c.modResults[key] ?? []);
    groups.add(appGroup);
    c.modResults[key] = [...groups];
    return c;
  });
}

function withBroadcastInfo(config, appGroup, extensionId) {
  return withInfoPlist(config, (c) => {
    // Read by LiveKit (BroadcastBundleInfo); explicit, so a custom app
    // group or a renamed bundle cannot silently disable sharing.
    c.modResults.RTCAppGroupIdentifier = appGroup;
    c.modResults.RTCScreenSharingExtension = extensionId;
    return c;
  });
}

const sampleHandler = `#if canImport(LiveKitClient)
import LiveKitClient // CocoaPods module name
#else
import LiveKit // SwiftPM module name
#endif

// The whole broadcast: LiveKit captures the screen and hands it to the
// app, which publishes it into the call.
class SampleHandler: LKSampleHandler {}
`;

function extensionInfoPlist(config) {
  const name = config.name ?? 'App';
  const version = config.version ?? '1.0.0';
  const build = String(config.ios?.buildNumber ?? '1');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>${name}</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${build}</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.broadcast-services-upload</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).SampleHandler</string>
    <key>RPBroadcastProcessMode</key>
    <string>RPBroadcastProcessModeSampleBuffer</string>
  </dict>
</dict>
</plist>
`;
}

function entitlements(appGroup) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${appGroup}</string>
  </array>
</dict>
</plist>
`;
}

function withExtensionFiles(config, appGroup) {
  return withDangerousMod(config, [
    'ios',
    (c) => {
      const root = c.modRequest.platformProjectRoot;
      const dir = path.join(root, TARGET);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SampleHandler.swift'), sampleHandler);
      fs.writeFileSync(path.join(dir, 'Info.plist'), extensionInfoPlist(c));
      fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), entitlements(appGroup));

      // LiveKit in the extension: the same pod (and so the same version)
      // the app already resolves through @poolse/native.
      const podfile = path.join(root, 'Podfile');
      const text = fs.readFileSync(podfile, 'utf8');
      if (!text.includes(`target '${TARGET}'`)) {
        fs.writeFileSync(
          podfile,
          `${text.trimEnd()}\n\n# @poolse/native: the screen-sharing broadcast extension.\ntarget '${TARGET}' do\n  pod 'LiveKitClient'\nend\n`,
        );
      }
      return c;
    },
  ]);
}

function withExtensionTarget(config, extensionId) {
  return withXcodeProject(config, (c) => {
    const project = c.modResults;
    if (project.pbxTargetByName(TARGET)) return c;

    const files = ['SampleHandler.swift', 'Info.plist', `${TARGET}.entitlements`];
    const group = project.addPbxGroup(files, TARGET, TARGET);
    const groups = project.hash.project.objects.PBXGroup;
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      // The project's root group: no name, no path.
      if (typeof g === 'object' && g.name === undefined && g.path === undefined) {
        project.addToPbxGroup(group.uuid, key);
      }
    }

    // The xcode library assumes these sections exist.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

    // app_extension also embeds the .appex in the app and makes the app
    // depend on it.
    const target = project.addTarget(TARGET, 'app_extension', TARGET, extensionId);
    project.addBuildPhase(['SampleHandler.swift'], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    // Signing and deployment follow the app's own target.
    const app = project.getFirstTarget().firstTarget;
    const appConfigs =
      project.pbxXCConfigurationList()[app.buildConfigurationList].buildConfigurations;
    const sections = project.pbxXCBuildConfigurationSection();
    const appSettings = sections[appConfigs[0].value].buildSettings;
    const team = appSettings.DEVELOPMENT_TEAM ?? c.ios?.appleTeamId;

    for (const key of Object.keys(sections)) {
      const settings = sections[key].buildSettings;
      if (!settings || settings.PRODUCT_NAME !== `"${TARGET}"`) continue;
      Object.assign(settings, {
        INFOPLIST_FILE: `${TARGET}/Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
        CODE_SIGN_STYLE: 'Automatic',
        IPHONEOS_DEPLOYMENT_TARGET: appSettings.IPHONEOS_DEPLOYMENT_TARGET ?? '15.1',
        TARGETED_DEVICE_FAMILY: appSettings.TARGETED_DEVICE_FAMILY ?? '"1,2"',
        SWIFT_VERSION: '5.0',
        SKIP_INSTALL: 'YES',
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        // LiveKit's WebRTC framework is embedded once, in the app.
        LD_RUNPATH_SEARCH_PATHS:
          '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        ...(team ? { DEVELOPMENT_TEAM: team } : {}),
      });
    }
    if (team) project.addTargetAttribute('DevelopmentTeam', team, target);
    return c;
  });
}

module.exports = function withScreenShare(config, options = {}) {
  const { extensionId, appGroup } = ids(config, options);
  config = withAppGroup(config, appGroup);
  config = withBroadcastInfo(config, appGroup, extensionId);
  config = withExtensionFiles(config, appGroup);
  config = withExtensionTarget(config, extensionId);
  return config;
};
