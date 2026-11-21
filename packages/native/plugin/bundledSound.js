/**
 * Shared by the `ringback` and `ringtone` options: copy a sound file into
 * the iOS app bundle (as a member of the Resources build phase) and into
 * Android's `res/raw`, on every `expo prebuild`.
 */
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/** Android resource names: lowercase letters, digits and underscores. */
const ANDROID_NAME = /^[a-z][a-z0-9_]*$/;

function sourceOf(cfg, file, label, missing) {
  const source = path.resolve(cfg.modRequest.projectRoot, file);
  if (!fs.existsSync(source)) {
    throw new Error(`@poolse/native: ${label} ${source} is missing. ${missing}`);
  }
  return source;
}

/** Copy `file` next to the app's sources and add it to the .app's resources. */
function withIosBundleSound(config, file, label, missing) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const target = path.join(
        cfg.modRequest.platformProjectRoot,
        cfg.modRequest.projectName,
        path.basename(file),
      );
      fs.copyFileSync(sourceOf(cfg, file, label, missing), target);
      return cfg;
    },
  ]);
  return withXcodeProject(config, (cfg) => {
    const groupName = cfg.modRequest.projectName;
    const filepath = `${groupName}/${path.basename(file)}`;

    // Copying the file in is not enough — it has to be a member of the
    // Resources build phase or it never reaches the .app, and iOS
    // silently falls back to its own sound.
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

/** Copy `file` into `android/app/src/main/res/raw/`. */
function withAndroidRawSound(config, file, label, missing) {
  const name = path.parse(file).name;
  if (!ANDROID_NAME.test(name)) {
    throw new Error(
      `@poolse/native: ${label} "${path.basename(file)}" — the name must be ` +
        'lowercase letters, digits and underscores (an Android resource name).',
    );
  }
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const rawDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'raw',
      );
      fs.mkdirSync(rawDir, { recursive: true });
      fs.copyFileSync(sourceOf(cfg, file, label, missing), path.join(rawDir, path.basename(file)));
      return cfg;
    },
  ]);
}

module.exports = { ANDROID_NAME, withIosBundleSound, withAndroidRawSound };
