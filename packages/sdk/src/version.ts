// Single source of truth for the SDK version at runtime. Must match
// packages/sdk/package.json — version.test.ts asserts it, because this
// silently drifted to 2.0.10 while the package shipped 2.1.6 and the
// old test only checked that it was semver-shaped.
export const version = '2.8.4';
