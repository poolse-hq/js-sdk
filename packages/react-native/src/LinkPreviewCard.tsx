import { safeLinkUrl, type LinkPreview } from '@poolse/sdk';
import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface LinkPreviewCardProps {
  preview: LinkPreview;
  /** Shows a × on the card; the long-press sheet's "Remove preview" is the usual way. */
  onRemove?: () => void;
  /** Card width cap in px. Defaults to 320. */
  maxWidth?: number;
  /** `'onBrand'` for a card inside your own (accent-filled) bubble. */
  tone?: 'default' | 'onBrand';
  /** Long-press on the card — rows pass their actions sheet. */
  onLongPress?: () => void;
}

/**
 * A link's preview under the message text. `website`: the page's image,
 * site name with favicon, title and description. `image`: the picture
 * itself, inline. Tapping opens the link.
 */
export function LinkPreviewCard({
  preview,
  onRemove,
  maxWidth = 320,
  tone = 'default',
  onLongPress,
}: LinkPreviewCardProps) {
  const theme = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const onBrand = tone === 'onBrand';
  const open = () => {
    const url = safeLinkUrl(preview.url);
    if (url) void Linking.openURL(url).catch(() => undefined);
  };
  const site = preview.site_name || hostOf(preview.url);
  const text = onBrand ? theme.colors.ownBubbleText : theme.colors.text;
  const muted = onBrand ? theme.colors.ownBubbleText : theme.colors.textMuted;

  const removeBtn = onRemove ? (
    <Pressable
      onPress={onRemove}
      hitSlop={8}
      style={[styles.remove, { backgroundColor: theme.colors.overlay }]}
      accessibilityRole="button"
      accessibilityLabel="Remove preview"
    >
      <PoolseIcon name="close" size={12} color="#FFFFFF" label={null} />
    </Pressable>
  ) : null;

  if (preview.type === 'image') {
    // Images load straight from the site: http(s) only, as on web.
    const src = isWebUrl(preview.image_url)
      ? preview.image_url
      : isWebUrl(preview.url)
        ? preview.url
        : null;
    if (imageFailed || !src) return null;
    return (
      <Pressable
        onPress={open}
        {...(onLongPress ? { onLongPress } : {})}
        accessibilityRole="link"
        accessibilityLabel={preview.title || 'Image link'}
        style={[styles.imageOnly, { maxWidth, borderRadius: theme.radii.md }]}
      >
        <Image
          source={{ uri: src }}
          style={[styles.inlineImage, { borderRadius: theme.radii.md }]}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
          accessible={false}
        />
        {removeBtn}
      </Pressable>
    );
  }

  const hasImage = !!preview.image_url && isWebUrl(preview.image_url) && !imageFailed;
  return (
    <Pressable
      onPress={open}
      {...(onLongPress ? { onLongPress } : {})}
      accessibilityRole="link"
      accessibilityLabel={[site, preview.title].filter(Boolean).join(': ') || preview.url}
      style={({ pressed }) => [
        styles.card,
        {
          maxWidth,
          borderRadius: theme.radii.md,
          backgroundColor: onBrand ? 'rgba(0,0,0,0.16)' : theme.colors.surfaceAlt,
          borderLeftColor: onBrand ? theme.colors.ownBubbleText : theme.colors.accent,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {hasImage ? (
        <Image
          source={{ uri: preview.image_url! }}
          style={[
            styles.cardImage,
            { borderTopLeftRadius: theme.radii.md, borderTopRightRadius: theme.radii.md },
          ]}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
          accessible={false}
        />
      ) : null}
      <View style={[styles.cardBody, { padding: theme.spacing.sm, gap: 2 }]}>
        <View style={styles.siteLine}>
          {preview.favicon_url && isWebUrl(preview.favicon_url) && !faviconFailed ? (
            <Image
              source={{ uri: preview.favicon_url }}
              style={styles.favicon}
              onError={() => setFaviconFailed(true)}
              accessible={false}
            />
          ) : (
            <PoolseIcon name="link" size={12} color={muted} label={null} />
          )}
          <Text
            style={[styles.site, { color: muted, fontFamily: theme.fonts.body }]}
            numberOfLines={1}
          >
            {site}
          </Text>
        </View>
        {preview.title ? (
          <Text
            style={[
              styles.title,
              { color: onBrand ? text : theme.colors.link, fontFamily: theme.fonts.body },
            ]}
            numberOfLines={2}
          >
            {preview.title}
          </Text>
        ) : null}
        {preview.description ? (
          <Text
            style={[styles.description, { color: muted, fontFamily: theme.fonts.body }]}
            numberOfLines={2}
          >
            {preview.description}
          </Text>
        ) : null}
      </View>
      {removeBtn}
    </Pressable>
  );
}

function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  return (m?.[1] ?? url).replace(/^www\./, '');
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    borderLeftWidth: 3,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    aspectRatio: 1.91,
  },
  cardBody: {},
  siteLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  favicon: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  site: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
  },
  title: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  description: {
    fontSize: 12.5,
    opacity: 0.9,
  },
  imageOnly: {
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  inlineImage: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  remove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function isWebUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}
