export { PoolseIcon, type PoolseIconProps, type IconName } from './PoolseIcon.js';
export { PoolseLogo, type PoolseLogoProps, type PoolseLogoVariant } from './PoolseLogo.js';
export { Avatar, type AvatarProps } from './Avatar.js';
export { userColor } from './userColor.js';

// Re-exported as a namespace for the public API surface.
import { PoolseIcon } from './PoolseIcon.js';
import { PoolseLogo } from './PoolseLogo.js';
import { Avatar } from './Avatar.js';

export const primitives = { PoolseIcon, PoolseLogo, Avatar };
