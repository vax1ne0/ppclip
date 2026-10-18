# Agents and sidebar

Attention statuses, pending confirmations, urgency ordering, and the Agents page extra columns and task hover card.

Open **Agents → an agent → Customization** to personalize its animated mascot. Preview any of 17 color palettes and nine expressions, or use **Surprise me**. **Save appearance** persists the colors across the app; **Discard** restores the saved appearance. Expression previews do not change the agent’s runtime status. Unsaved changes use the agent page’s navigation guard, and failed saves preserve the draft for retry.

For an agent using an uploaded avatar, saving a palette switches it back to the animated mascot. The uploaded asset is retained. This tab uses Paperclip’s existing appearance storage and company-scoped update endpoint.

Agent chat sidebar rows also show the configured model with a provider mark. An unset model is labeled “Model not set”; the full model and harness are available on hover. This follows the Agents page extras switch. Agent model pickers require an explicit choice and do not offer a default-model option.

New-agent setup shows the same model picker on both **Connect** and **Configure**, preserving the selection between steps. Choose the model before testing a saved subscription, API key or new sign-in. If model discovery fails, an explicit model ID can be entered manually.

**Settings → ppclip switch:** Agents and sidebar → Urgent agents first, Attention statuses, Agents page extras

Files here sit at the same paths they get inside Paperclip (`ui/src/ppclip/attention/`, `ui/src/ppclip/roster/`, `ui/src/ppclip/nav/`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
