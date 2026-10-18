# Team page

The /team canvas with reporting and work lines, Edit mode, Magic sort and group colours.

The agent count sits inside the canvas at the top left; Edit mode and view settings sit at the top right. Controls stay fixed while the hierarchy pans and zooms, and the canvas fills the former external toolbar space.

Team cards center Chat in their action row. When computer use is enabled, Chat and Computer form an evenly sized centered pair. Lifecycle buttons stay on the agent page; the card’s more-actions menu remains available.

Reporting lines favor entering a lower child from above (and an upper child from below) when comparing saved connection sides. A clear, single-elbow route wins over a slightly shorter side-entry dogleg. The preference is bounded: obstacles and substantially shorter routes can override it. Shared sibling branches and work-arrow routing retain their existing behavior.

After routing, opposing reporting elbows at the same agent port prefer one horizontal height. This local adjustment preserves endpoints, existing same-height junctions, and vertical directions; it stays between the two original heights and checks all visible cards. If no clear common height exists, both original paths remain. Same-side branches, unrelated trunks and work arrows keep their original routes.

Shared branch heights center the clear gap between the manager and its nearest report. A farther-away sibling cannot pull the horizontal line against the nearer cards; obstacle routing still uses tighter gaps when necessary.

All routes keep a 24px clearance around all four sides of cards and group outlines. Only the normal terminal connection may cross its own card’s clearance area. Grid search, saved-side shortcuts, shared branches and opposing-junction adjustments use the same rule, so narrow passages cannot bypass it. Open exits replace saved tight-side routes; layouts with no safe exit retain the existing “no clear route” annotation instead of drawing through or along a card. Team card names remain clickable without a hover underline.

**Settings → ppclip switch:** Pages → Team page

Files here sit at the same paths they get inside Paperclip (`ui/src/ppclip/team/`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
