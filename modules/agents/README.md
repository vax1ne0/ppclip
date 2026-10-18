# Agents and sidebar

Attention statuses, pending confirmations, urgency ordering, and the Agents page extra columns and task hover card.

Agent chat sidebar rows also show the configured model with a provider mark. An unset model is labeled “Model not set”; the full model and harness are available on hover. This follows the Agents page extras switch. Agent model pickers require an explicit choice and do not offer a default-model option.

New-agent setup shows the same model picker on both **Connect** and **Configure**, preserving the selection between steps. Choose the model before testing a saved subscription, API key or new sign-in. If model discovery fails, an explicit model ID can be entered manually.

**Settings → ppclip switch:** Agents and sidebar → Urgent agents first, Attention statuses, Agents page extras

Files here sit at the same paths they get inside Paperclip (`ui/src/ppclip/attention/`, `ui/src/ppclip/roster/`, `ui/src/ppclip/nav/`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
