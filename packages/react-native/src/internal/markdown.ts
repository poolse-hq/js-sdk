import { createElement, type ReactElement } from 'react';
import type { StyleSheet } from 'react-native';
// Static import — Metro's bundle graph can only trace literal
// `import` / `require` calls. The earlier try/require trick generated
// a `require('react-native-markdown-display')` that Metro couldn't
// resolve from inside our pre-bundled CJS dist, throwing a runtime
// "Requiring unknown module" even when the consumer had the package
// installed. Hard-importing puts the resolution into the consumer
// app's normal graph where it works the same way react-native-svg or
// expo-image-picker do.
//
// Trade-off: the package is now a required peer of @poolse/react-native
// (was optional). Consumers who don't want markdown can pass
// `markdown={false}` to <ConversationView> — the import stays in the
// bundle but the component isn't rendered.
import Markdown from 'react-native-markdown-display';

export interface MarkdownStyleArgs {
  textColor: string;
  linkColor: string;
  fontFamily?: string;
  fontSize: number;
  lineHeight: number;
  onLinkPress: (url: string) => boolean;
}

/**
 * Render `body` as Markdown into a React element. The style mapping
 * uses the bubble's resolved theme tokens so text color tracks self /
 * other bubble background.
 */
export function renderMarkdown(body: string, args: MarkdownStyleArgs): ReactElement {
  const baseText = {
    color: args.textColor,
    fontFamily: args.fontFamily,
    fontSize: args.fontSize,
    lineHeight: args.lineHeight,
  };
  // Match react-ui's GFM defaults — body+inline elements use bubble
  // text color; links pick up the brand-on-bubble color so they
  // remain visible whether the bubble is a self-brand or
  // other-surface variant.
  const style: StyleSheet.NamedStyles<unknown> = {
    body: baseText,
    paragraph: { ...baseText, marginTop: 0, marginBottom: 0 },
    text: baseText,
    strong: { ...baseText, fontWeight: '700' },
    em: { ...baseText, fontStyle: 'italic' },
    s: { ...baseText, textDecorationLine: 'line-through' },
    link: { color: args.linkColor, textDecorationLine: 'underline' },
    code_inline: {
      ...baseText,
      backgroundColor: 'rgba(127,127,127,0.18)',
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    code_block: {
      ...baseText,
      backgroundColor: 'rgba(127,127,127,0.18)',
      padding: 8,
      borderRadius: 6,
    },
    fence: {
      ...baseText,
      backgroundColor: 'rgba(127,127,127,0.18)',
      padding: 8,
      borderRadius: 6,
    },
    bullet_list: { marginTop: 2, marginBottom: 2 },
    ordered_list: { marginTop: 2, marginBottom: 2 },
    list_item: baseText,
    blockquote: {
      ...baseText,
      borderLeftWidth: 3,
      borderLeftColor: args.linkColor,
      paddingLeft: 8,
      marginVertical: 4,
      opacity: 0.85,
    },
  };
  return createElement(Markdown, { style, onLinkPress: args.onLinkPress }, body);
}
