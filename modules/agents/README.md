# Agents and sidebar

Attention statuses, pending confirmations, urgency ordering, and the Agents page extra columns and task hover card.

Open **Agents → an agent → Customization** to personalize its animated mascot. Pick any two body colors using color pickers or six-digit hex values, swap the gradient, or use the same color twice for a solid look. The 17 palettes remain available under **Preset starting points**, alongside **Surprise me** and nine expression previews. **Save appearance** persists the colors across the app; **Discard** restores the saved appearance. Invalid or incomplete hex values block saving. Expression previews do not change the agent’s runtime status. Unsaved changes use the agent page’s navigation guard, and failed saves preserve the draft for retry.

For an agent using an uploaded avatar, saving body colors switches it back to the animated mascot. The uploaded asset is retained. This tab uses Paperclip’s existing appearance JSON storage and company-scoped update endpoint. Optional `customColors: { a, b }` values override the fallback `paletteId`; both colors are validated and normalized to lowercase hex. Animated and static renderers share these values. Generated PNG URLs and cache keys include both colors, while muted avatars keep their muted presentation. Existing appearances remain compatible; no database migration is needed.

Body-color swatches open the same `react-colorful` saturation/hue picker used by team role groups. Changes update the active mascot player immediately without recreating it. Custom-color still portraits render locally as SVGs, including reduced-motion previews, so dragging never queues server PNG renders. A loading spinner covers missing portraits; the previous loaded image stays visible during replacement. Failed image loads retry twice before showing an unavailable icon, rather than agent initials.

**Gradient placement** offers separate center and rotation controls over a still preview, plus horizontal/vertical center and angle sliders. Placement is saved as optional `gradient: { x, y, angle }` (integer percentages 0–100, degrees −180–180). Reset restores the original centered 20° gradient. Changing colors preserves placement. Both GPU and SVG renderers honor it; PNG URLs and cache keys distinguish transforms. Muted portraits retain their original appearance.

**Adjust center of gradient** toggles a circular control; the mascot silhouette constrains the whole circle, including the rounded dome and lower corners. **Adjust gradient angle** toggles the rotation line separately, with a dashed orbit, larger invisible hit areas and a live coordinate/angle readout. Precision sliders remain available. The preview tracks the cursor across its entire box; the page-header mascot follows the cursor across the whole app viewport. The editor has a dedicated canvas so both stay interactive. While adjusting, the preview pauses its pose and cursor tracking but redraws each gradient change immediately, including with reduced motion enabled. Other placements retain the shared animation slot.

**Surprise me** generates two independent 24-bit hex colors, preserving gradient placement. A successful save publishes the confirmed appearance immediately to the agent-list, detail and identity caches before refreshing them. Small custom portraits retain full body shading and load eagerly so sidebar thumbnails reflect the saved design. Shared tooltip hooks use the existing gray popover surface, foreground and border tokens.

Agent edit forms use the layout’s action dock outside the scrolling content. Customization, instructions and configuration share this dock so page padding cannot leave visible content below the save bar.

Agent chat sidebar rows also show the configured model with a provider mark. An unset model is labeled “Model not set”; the full model and harness are available on hover. This follows the Agents page extras switch. Agent model pickers require an explicit choice and do not offer a default-model option.

New-agent setup shows the same model picker on both **Connect** and **Configure**, preserving the selection between steps. Choose the model before testing a saved subscription, API key or new sign-in. If model discovery fails, an explicit model ID can be entered manually.

**Settings → ppclip switch:** Agents and sidebar → Urgent agents first, Attention statuses, Agents page extras

Files here sit at the same paths they get inside Paperclip (`ui/src/ppclip/attention/`, `ui/src/ppclip/roster/`, `ui/src/ppclip/nav/`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
