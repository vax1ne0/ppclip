# Approved models

Approved models restricts the exact model IDs a company may use with each harness. It does not select a model for an agent and does not estimate prices or impose a token budget.

## Settings and scope

- **Settings → ppclip → Providers → Approved models** makes the module available across the instance. Its `modelApprovals` flag defaults to `true`, including when an older settings file has no value for it. Only an instance administrator may change module switches.
- **Provider settings → Approved models** manages the selected company's list. Reading requires board access to that company; editing requires the same authority as managing agents (`agents:create`).
- Turning the module off hides the panel, makes its policy routes return the usual module-disabled 404, and bypasses approval checks for subsequent dispatches. It preserves the list. Turning it back on restores enforcement without restarting.
- Module changes do not cancel a run already executing. The module does not restore the separate, previously removed “Default model” picker option.

## Enforcement

With the module on, model-based runs require an explicit model other than `default` or `auto`, and an exact matching harness/model entry. The final effective runtime configuration is checked before provider dispatch in both native and legacy execution paths. Task overrides and retries go through this check. Automatic provider switching checks the target configuration before saving it. Supported model override flags in extra CLI arguments are refused in favor of the Model field.

Process, HTTP and external gateway/bot runtimes without a locally selected model are exempt. An approved ID does not guarantee that a provider supports it or that its account has access. This is a dispatch policy, not a boundary against a custom executable or an agent independently invoking another model through shell or network tools.

Removing all entries blocks new model-based runs while the module is on. Missing or unreadable policy data does not implicitly authorize a model.

## Existing installations and storage

During active-server startup with the module enabled, companies without a policy receive a one-time snapshot of explicit models already configured on non-terminated, non-pending-approval agents. Unset models are never guessed. Later agent edits do not expand an existing list. Warm standby servers skip initialization.

If the module was off during startup, enabling it later does not initialize missing lists immediately. Configure those lists in Providers; until then, new model-based dispatches are blocked.

Lists are company-scoped policy snapshots in `activity_log` under `ppclip.model_policy.updated`, with entity type `ppclip_model_policy`. Each edit is audited. Saves serialize through a company-specific transaction advisory lock and require the current revision; stale edits return a conflict. Reads select the highest revision because transaction timestamps can predate a lock wait. Retain these snapshots when implementing activity-log pruning or exports; they currently hold live policy state, not just historical receipts.

The module flag is stored separately in the instance's `ppclip-features.json`, alongside the other module switches. An unreadable features file follows the existing module system's default of all modules on.

## Code and verification

The implementation lives in `modules/providers/server/src/ppclip/providers/model-policy.ts`; the UI is `modules/providers/ui/src/ppclip/providers/ModelApprovals.tsx`. Core owns the server feature keys and UI registry. Shared runtime hooks live in `hooks/<version>/hooks.patch`.

Run these commands inside the installed Paperclip checkout after copying/installing the overlay:

```bash
cd server
npx vitest run src/__tests__/ppclip-features.test.ts src/__tests__/ppclip-provider-model-policy.test.ts src/__tests__/ppclip-provider-routing.test.ts src/services/heartbeat/runtime-execution.test.ts
```

```bash
cd ui
npx vitest run src/ppclip/features/features.test.tsx src/ppclip/providers/ModelApprovals.test.tsx src/ppclip/providers/providers.test.tsx
```

Routing and execution integration tests use isolated embedded Postgres. The policy and UI tests cover disabled-module behavior, deliberate saves, conflicts, revocation, exact matching, and override rejection without paid model calls.
