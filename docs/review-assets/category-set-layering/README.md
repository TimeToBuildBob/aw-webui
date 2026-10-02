# Category-set layering review images

Before: `45e9c41` (parent of the feature). After: `c88fe1e419e5`
(ActivityWatch/aw-webui#1027). Both images come from production webpack builds
served by aw-server-rust with the same two synthetic category sets, `mine` and
`programmer-profile`, and both IDs active.

- [Before](before.png): merged categories appear, but there is no control to select an additional set.
- [After](after.png): the checked **Also apply** row exposes layering and explains where edits are saved.

Captured with Playwright bundled Chromium on 2026-10-02, at a 1280 × 1000
viewport with full-page capture. The missing header logo reproduces in both
builds. These review assets live on a separate branch so they do not expand
the application PR's diff.
