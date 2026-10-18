// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NewAgentSetup } from "@/components/new-agent/NewAgentSetup";

const mocks = vi.hoisted(() => ({ models: vi.fn(), probe: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-fixture" }) }));
vi.mock("@/context/DialogContext", () => ({ useDialogActions: () => ({ openNewIssue: vi.fn() }) }));
vi.mock("@/lib/router", () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams("name=Test&adapterType=codex_local&runner=legacy")] }));
vi.mock("@/hooks/useCloudInstance", () => ({ useCloudInstance: () => false }));
vi.mock("@/components/AgentCharacter", () => ({ AgentCharacter: () => null }));
vi.mock("@/components/ai-connections/useConnectionModels", () => ({ useConnectionModels: () => null }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async () => [], adapterModels: mocks.models } }));
vi.mock("@/api/adapters", () => ({ adaptersApi: { list: async () => [{ type: "codex_local", loaded: true, disabled: false, defaultRunner: "legacy", supportedRunners: ["legacy"] }] } }));
vi.mock("@/api/environments", () => ({ environmentsApi: { list: async () => [], capabilities: async () => ({}) } }));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: { get: async () => ({}), getExperimental: async () => ({}), getGeneral: async () => ({}) } }));
vi.mock("@/api/secrets", () => ({ secretsApi: { list: async () => [], listMyUserSecrets: async () => [] } }));
vi.mock("@/lib/test-agent-setup", () => ({ testAgentSetup: mocks.probe }));
// Account login is an external boundary. Keep the real setup, validation and
// ModelDropdown, and drive the same parent callback as a saved subscription.
vi.mock("@/components/new-agent/AgentProviderConnection", () => ({
  AgentProviderConnection: ({ testConnection, testError, onConnected }: { testConnection: (value: object) => Promise<boolean>; testError?: string; onConnected: (value: object) => void }) => <>
    {testError && <p role="alert">{testError}</p>}
    <button onClick={async () => { const connection = { env: {}, aiConnection: { mode: "responsible_user", provider: "openai", method: "subscription" } }; if (await testConnection(connection)) onConnected(connection); }}>Use saved subscription</button>
  </>,
}));

let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.models.mockReset().mockResolvedValue([{ id: "gpt-5.4-mini", label: "GPT 5.4 mini" }]);
  mocks.probe.mockReset().mockResolvedValue({ status: "pass", checks: [{ code: "codex_hello_probe_passed", level: "info", message: "Ready" }] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => { root.render(<QueryClientProvider client={client}><TooltipProvider><NewAgentSetup /></TooltipProvider></QueryClientProvider>); });
  await vi.waitFor(() => expect(host.textContent).toContain("Use saved subscription"));
}
async function clickText(text: string) {
  const button = [...document.querySelectorAll("button")].find(el => el.textContent?.includes(text));
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
}

it("lets the user choose an explicit model before a saved-subscription probe", async () => {
  await render();
  expect(host.querySelector('[data-testid="ppclip-connect-model-picker"]')).not.toBeNull();
  await clickText("Use saved subscription");
  expect(host.textContent).toContain("Choose an explicit model before continuing");
  expect(mocks.probe).not.toHaveBeenCalled();
  await clickText("Select model (required)");
  const option = document.querySelector<HTMLElement>('[role="option"]');
  expect(option?.textContent).toContain("GPT 5.4 mini");
  await act(async () => { option!.click(); });
  expect(host.textContent).not.toContain("Choose an explicit model before continuing");
  await clickText("Use saved subscription");
  expect(mocks.probe).toHaveBeenCalledWith(expect.objectContaining({ adapterConfig: expect.objectContaining({ model: "gpt-5.4-mini" }) }));
  await vi.waitFor(() => expect(host.textContent).toContain("Configure your agent"));
  expect(host.textContent).toContain("GPT 5.4 mini");
});

it("offers manual model entry when discovery fails", async () => {
  mocks.models.mockRejectedValue(new Error("Discovery unavailable"));
  await render();
  await vi.waitFor(() => expect(host.textContent).toContain("Could not load models"));
  await clickText("Select model (required)");
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Search models... (type to create)"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "explicit-model-id");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickText('explicit-model-id');
  await clickText("Use saved subscription");
  expect(mocks.probe).toHaveBeenCalledWith(expect.objectContaining({ adapterConfig: expect.objectContaining({ model: "explicit-model-id" }) }));
});
