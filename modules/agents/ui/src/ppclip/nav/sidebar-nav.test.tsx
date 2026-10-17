// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/queryKeys";
import { Sidebar } from "@/components/Sidebar";
import { Sidebar as LegacySidebar } from "@/components/Sidebar.production";
import { AgentConversationsSidebar } from "@/components/AgentConversationsSidebar";
import { attentionFeedQueryKey, blockedTasksQueryKey } from "@/ppclip/attention/useAgentAttention";
import { feedItem } from "@/ppclip/attention/test-fixtures";

const state = vi.hoisted(() => ({ experimental: {} as Record<string, unknown> }));

vi.mock("@/lib/router", () => ({
  NavLink: ({ to, children, className, ...props }: { to: string; children: ReactNode; className?: string | ((s: { isActive: boolean }) => string) }) => (
    <a href={to} className={typeof className === "function" ? className({ isActive: false }) : className} {...props}>{children}</a>
  ),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
  useLocation: () => ({ pathname: "/PAP/chats", search: "", hash: "", state: null }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/context/DialogContext", () => ({ useDialogActions: () => ({ openNewIssue: vi.fn(), openNewAgent: vi.fn() }) }));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { id: "company-1", issuePrefix: "PAP", name: "Paperclip" } }),
}));
vi.mock("@/context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false, setSidebarOpen: vi.fn(), collapsed: false, peeking: false }),
}));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: { liveRunsForCompany: vi.fn(async () => []) } }));
vi.mock("@/api/attention", () => ({ attentionApi: { list: vi.fn(async () => ({ items: [] })) } }));
vi.mock("@/api/issues", () => ({ issuesApi: { list: vi.fn(async () => []) } }));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: vi.fn(async () => state.experimental) } }));
vi.mock("@/hooks/useInboxBadge", () => ({ useInboxBadge: () => ({ inbox: 0, failedRuns: 0 }) }));
vi.mock("@/plugins/slots", () => ({ PluginSlotOutlet: () => null }));
vi.mock("@/plugins/launchers", () => ({ PluginLauncherOutlet: () => null }));
vi.mock("@/components/SidebarCompanyMenu", () => ({ SidebarCompanyMenu: () => null }));
vi.mock("@/components/SidebarCompanyMenu.production", () => ({ SidebarCompanyMenu: () => null }));
vi.mock("@/components/SidebarAgents", () => ({ SidebarAgents: () => null }));
vi.mock("@/components/SidebarAgents.production", () => ({ SidebarAgents: () => null }));
vi.mock("@/components/SidebarProjects", () => ({ SidebarProjects: () => null }));
vi.mock("@/components/SidebarStarredProjects", () => ({ SidebarStarredProjects: () => null }));
vi.mock("@/components/SidebarStarredProjects.production", () => ({ SidebarStarredProjects: () => null }));
vi.mock("@/components/SidebarRecentTasks", () => ({ SidebarRecentTasks: () => null }));
// Chat rail data
vi.mock("@/hooks/useAgentChatEnabled", () => ({ useAgentChatEnabled: () => ({ enabled: true, loaded: true }) }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: vi.fn(), get: vi.fn() } }));
vi.mock("@/api/agentChats", () => ({ agentChatsApi: { list: vi.fn(), ensure: vi.fn() } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: () => ({ user: { id: "user-a" } }) } }));
vi.mock("@/components/AgentAvatar", () => ({ AgentAvatar: () => null }));
vi.mock("@/api/resourceMemberships", () => ({ resourceMembershipsApi: {
  listMine: async () => ({ projectMemberships: {}, agentMemberships: {}, starredProjectIds: [], starredAgentIds: [], starredDocumentIds: [] }),
} }));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function render(node: ReactNode) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>);
  });
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const navLabels = () => [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  state.experimental = {};
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

describe("NAV-1 Team link", () => {
  it("sits directly under Inbox in the default (streamlined) sidebar", async () => {
    await render(<Sidebar />);
    const links = navLabels();
    expect(links.indexOf("/team")).toBe(links.indexOf("/inbox") + 1);
    expect(container.querySelector("a[href='/team']")?.textContent).toContain("Team");
  });

  it("takes Inbox's place when Combined Inbox + Task List removes the Inbox row", async () => {
    state.experimental = { enableCombinedInboxTasks: true };
    await render(<Sidebar />);
    const links = navLabels();
    expect(links).not.toContain("/inbox");
    expect(links.indexOf("/team")).toBe(links.indexOf("/dashboard") + 1);
  });

  it("sits directly under Inbox in the legacy shell", async () => {
    await render(<LegacySidebar />);
    const links = navLabels();
    expect(links.indexOf("/team")).toBe(links.indexOf("/inbox") + 1);
  });
});

describe("NAV-1 chat rail urgency order", () => {
  const agent = (id: string, status = "idle") => ({ id, companyId: "company-1", name: id, urlKey: id, role: "general", title: "Teammate", status } as Agent);

  it("lists running, then waiting/pending, then blocked/error, then idle, keeping official order within groups", async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(queryKeys.auth.session, { user: { id: "user-a" } });
    // Official order: conversations (recent first), then the rest alphabetically.
    client.setQueryData(queryKeys.agentChats.list("company-1", "user-a"), [
      { id: "chat-idle", companyId: "company-1", conversationAgentId: "idle-chat", conversationUserId: "user-a" },
    ]);
    client.setQueryData(queryKeys.agents.list("company-1"), [
      agent("idle-chat"), agent("alpha"), agent("blocked"), agent("broken", "error"), agent("live"), agent("pending"), agent("waiting"), agent("zulu", "running"),
    ]);
    client.setQueryData(queryKeys.liveRuns("company-1"), [{ id: "run-1", agentId: "live", status: "running" }]);
    client.setQueryData(attentionFeedQueryKey("company-1"), { items: [feedItem({ createdBy: "waiting" })] });
    client.setQueryData(blockedTasksQueryKey("company-1"), [
      { id: "t1", title: "A", status: "blocked", assigneeAgentId: "pending", blockedBy: [{ id: "b1", title: "B", status: "todo", assigneeAgentId: "alpha" }] },
      { id: "t2", title: "C", status: "blocked", assigneeAgentId: "blocked", blockedBy: [] },
    ]);
    await render(<AgentConversationsSidebar />);
    const order = [...container.querySelectorAll('nav[aria-label="Agent conversations"] a')].map((link) => link.getAttribute("href"));
    expect(order).toEqual([
      "/chats/live", "/chats/zulu",
      "/chats/pending", "/chats/waiting",
      "/chats/blocked", "/chats/broken",
      "/chats/idle-chat", "/chats/alpha",
    ]);
  });
});
