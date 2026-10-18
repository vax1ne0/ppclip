# Team page

The /team canvas with reporting and work lines, Edit mode, Magic sort and group colours.

The agent count sits inside the canvas at the top left; Edit mode and view settings sit at the top right. Controls stay fixed while the hierarchy pans and zooms, and the canvas fills the former external toolbar space.

Team cards center Chat in their action row. When computer use is enabled, Chat and Computer form an evenly sized centered pair. Lifecycle buttons stay on the agent page; the card’s more-actions menu remains available.

Reporting lines favor entering a lower child from above (and an upper child from below) when comparing saved connection sides. A clear, single-elbow route wins over a slightly shorter side-entry dogleg. The preference is bounded: obstacles and substantially shorter routes can override it. Shared sibling branches and work-arrow routing retain their existing behavior.

Shared reporting branches choose the clear horizontal height that aligns the most siblings, preferring the common midpoint when equally clear. A blocked child falls back to individual routing without forcing other clear siblings onto separate heights. Every shared segment is checked against all visible cards.

**Settings → ppclip switch:** Pages → Team page

Files here sit at the same paths they get inside Paperclip (`ui/src/ppclip/team/`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
