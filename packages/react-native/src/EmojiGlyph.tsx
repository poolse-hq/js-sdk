// One emoji: the image of a known `:name:` custom emoji (MS10), else the text.

import { findCustomEmoji, useCustomEmoji, type CustomEmoji } from '@poolse/react';
import { Image, Text, type StyleProp, type TextStyle } from 'react-native';

export function EmojiGlyph({
  emoji,
  size = 22,
  customEmoji,
  style,
}: {
  emoji: string;
  size?: number;
  customEmoji?: readonly CustomEmoji[];
  /** Style for the text form. */
  style?: StyleProp<TextStyle>;
}) {
  const scoped = useCustomEmoji();
  const custom = findCustomEmoji(emoji, customEmoji ?? scoped);
  if (!custom) return <Text style={style}>{emoji}</Text>;
  return (
    <Image
      source={{ uri: custom.url }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel={emoji}
    />
  );
}
