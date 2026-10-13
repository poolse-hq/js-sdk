import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { callColors } from './callTheme.js';

/**
 * The call scene: near-black with a slow brand glow rising behind the
 * caller's identity, and a fainter counter-glow low in the frame so
 * the dark has depth instead of reading as an unstyled void.
 *
 * Pure SVG — no blur views, no extra native deps — so it costs one
 * static layer and renders identically everywhere.
 */
export function CallBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="call-glow-top" cx="50%" cy="26%" r="62%">
            <Stop offset="0" stopColor={callColors.glow} stopOpacity={0.5} />
            <Stop offset="0.55" stopColor={callColors.glow} stopOpacity={0.16} />
            <Stop offset="1" stopColor={callColors.glow} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="call-glow-low" cx="12%" cy="96%" r="70%">
            <Stop offset="0" stopColor={callColors.glowWarm} stopOpacity={0.2} />
            <Stop offset="1" stopColor={callColors.glowWarm} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={callColors.bg} />
        <Rect width="100%" height="100%" fill="url(#call-glow-top)" />
        <Rect width="100%" height="100%" fill="url(#call-glow-low)" />
      </Svg>
    </View>
  );
}
