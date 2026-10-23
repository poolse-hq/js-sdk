/**
 * Config plugin: ship the ringback tone — what the caller hears while the
 * other phone rings — in both app bundles.
 *
 * The native core plays it by resource name: `configure({ ringback })`
 * with the file's base name finds the iOS bundle's `<name>.<ext>` and
 * Android's `res/raw/<name>`. Android resource names allow only
 * lowercase letters, digits and underscores, so the file must be named
 * that way.
 *
 * `expo prebuild` regenerates `ios/` and `android/` from scratch, so this
 * re-applies the file every time instead of it being added by hand.
 */
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

function sourceOf(cfg, file) {
  const source = path.resolve(cfg.modRequest.projectRoot, file);
  if (!fs.existsSync(source)) {
    throw new Error(
      `@poolse/react-native-calls: ringback ${source} is missing. Without it the ` +
        'caller hears nothing (Android) or an iPhone ringtone (iOS) while it rings.',
    );
  }
  return source;
}

function copyIntoProject(config, file) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const target = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName, path.basename(file));
      fs.copyFileSync(sourceOf(cfg, file), target);
      return cfg;
    },
  ]);
}

function addToBundle(config, file) {
  return withXcodeProject(config, (cfg) => {
    const groupName = cfg.modRequest.projectName;
    const filepath = `${groupName}/${path.basename(file)}`;

    // Copying the file in is not enough — it has to be a member of the
    // Resources build phase or it never reaches the .app, and
    // `_BUNDLE_` silently falls back to the ringtone again.
    //
    // Expo's helper rather than xcode's `addResourceFile` directly: the
    // latter wants a resolved PBXGroup and throws an opaque
    // "Cannot read properties of null (reading 'path')" when handed a
    // group name.
    if (!cfg.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath,
        groupName,
        project: cfg.modResults,
        isBuildFile: true,
      });
    }
    return cfg;
  });
}

function copyIntoAndroidRes(config, file) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const rawDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      fs.copyFileSync(sourceOf(cfg, file), path.join(rawDir, path.basename(file)));
      return cfg;
    },
  ]);
}

module.exports = function withRingback(config, file) {
  const name = path.parse(file).name;
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(
      `@poolse/react-native-calls: ringback "${path.basename(file)}" — the name must be ` +
        'lowercase letters, digits and underscores (an Android resource name).',
    );
  }
  return copyIntoAndroidRes(addToBundle(copyIntoProject(config, file), file), file);
};
