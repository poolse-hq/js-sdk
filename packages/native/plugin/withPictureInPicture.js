/**
 * Let the main activity float as a picture-in-picture
 * window during a video call (`@poolse/native`'
 * setPictureInPictureEnabled).
 *
 * Android only lets an activity that declares support enter PiP, and
 * resizing into the window is a configuration change: without
 * smallestScreenSize the activity would be destroyed and recreated as
 * it shrinks — the call keeps going, but the app restarts its UI.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const NEEDED = ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation'];

module.exports = function withPictureInPicture(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$?.['android:name'] === '.MainActivity');
    if (!main) throw new Error('withPictureInPicture: no .MainActivity in AndroidManifest');

    main.$['android:supportsPictureInPicture'] = 'true';
    main.$['android:resizeableActivity'] = 'true';
    const changes = new Set((main.$['android:configChanges'] ?? '').split('|').filter(Boolean));
    for (const c of NEEDED) changes.add(c);
    main.$['android:configChanges'] = [...changes].join('|');
    return cfg;
  });
};
