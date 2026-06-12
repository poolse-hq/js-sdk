import type { ReactElement } from 'react';
import { createElement } from 'react';

// Lazy-require `react-native-markdown-display`. We don't take a hard
// dependency because (a) the consumer may have intentionally chosen
// plain-text rendering for performance and (b) the lib carries
// transitive deps (react-native-fit-image, css-to-react-native) that
// not every host wants to ship. When it's missing the bubble falls
// back to plain text + a one-time warn.

type MarkdownComponent = (props: {
  style?: Record<string, unknown>;
  onLinkPress?: (url: string) => boolean;
  children?: string;
}) => ReactElement;

let MarkdownModule: { default?: MarkdownComponent } | null | undefined;
let warned = false;

function loadMarkdown(): MarkdownComponent | null {
  if (MarkdownModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      MarkdownModule = require('react-native-markdown-display') as typeof MarkdownModule;
    } catch {
      MarkdownModule = null;
    }
  }
  const fn = MarkdownModule?.default;
  if (!fn) {
    if (!warned) {
      warned = true;
      console.warn(
        '[@poolse/react-native] Markdown rendering requires `react-native-markdown-display`. Install it to enable bold/italic/code/links in message bubbles. Falling back to plain text.',
      );
    }
    return null;
  }
  return fn;
}

export interface MarkdownStyleArgs {
  textColor: string;
  linkColor: string;
  fontFamily?: string;
  fontSize: number;
  lineHeight: number;
  onLinkPress: (url: string) => boolean;
}

/**
 * Render `body` as Markdown into a React element, or return `null`
 * if the markdown library isn't installed (caller falls back to a
 * plain `<Text>`). The style mapping uses the bubble's resolved
 * theme tokens so text color tracks self / other bubble background.
 */
export function renderMarkdown(body: string, args: MarkdownStyleArgs): ReactElement | null {
  const Markdown = loadMarkdown();
  if (!Markdown) return null;
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
  const style: Record<string, unknown> = {
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
