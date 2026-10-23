/**
 * Turn on the native call core's LiveKit media adapter.
 *
 * The core ships its LiveKit MediaPort (io.livekit:livekit-android) in an
 * opt-in source set, gated on the `poolse.livekit` gradle property, so
 * the library carries no SFU dependency unless an app asks for it. This
 * sets that property; without it calls ring and connect with no audio.
 */
const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withNativeCallMedia(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (p) => !(p.type === 'property' && p.key === 'poolse.livekit'),
    );
    cfg.modResults.push({ type: 'property', key: 'poolse.livekit', value: 'true' });
    return cfg;
  });
};
