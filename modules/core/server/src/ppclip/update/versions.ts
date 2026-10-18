import type { UpdatePaths } from "./service.js";

export type ProductVersion = {
  current: string | null;
  latest: string | null;
  latestTag?: string;
  updateAvailable: boolean | null;
  checkFailed?: boolean;
};
export type UpdateVersions = {
  paperclip: ProductVersion & { compatibility: "supported" | "waiting" | "unknown" };
  ppclip: ProductVersion;
};
type Git = (dir: string, args: string[], timeout?: number) => Promise<string>;
type Manifest = { paperclipCommit?: string; paperclipTree?: string };

/** Accept Paperclip's stable and canary/v… tags; ignore unrelated tags. */
function version(tag: string) {
  return tag.match(/(?:^|\/)v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/)?.[1] ?? null;
}

export function compareVersions(a: string, b: string) {
  const parts = (s: string) => { const [core, ...pre] = s.split("-"); return { core: core!.split(".").map(Number), pre: pre.join("-") }; };
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i]! - right.core[i]!;
  if (!left.pre || !right.pre) return left.pre === right.pre ? 0 : left.pre ? -1 : 1;
  const l = left.pre.split("."), r = right.pre.split(".");
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    if (l[i] === r[i]) continue;
    if (l[i] === undefined || r[i] === undefined) return l[i] === undefined ? -1 : 1;
    const ln = /^\d+$/.test(l[i]!), rn = /^\d+$/.test(r[i]!);
    if (ln && rn) return Number(l[i]) - Number(r[i]);
    if (ln !== rn) return ln ? -1 : 1;
    return l[i]! < r[i]! ? -1 : 1;
  }
  return 0;
}

export function latestPaperclipTag(output: string, prereleases: boolean) {
  const tags = new Map<string, { version: string; commit: string; tag: string }>();
  for (const line of output.split("\n")) {
    const match = line.match(/^([a-f0-9]{40})\s+refs\/tags\/(.+?)(\^\{\})?$/);
    if (!match) continue;
    const name = version(match[2]!);
    if (!name || (!prereleases && name.includes("-"))) continue;
    // ls-remote lists annotated tags before their peeled commit.
    tags.set(name, { version: name, commit: match[1]!, tag: match[2]! });
  }
  return [...tags.values()].sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
}

/** ppclip has no package.json version: use its release tag plus build count. */
export async function versionLabel(dir: string, ref: string, git: Git) {
  const described = await git(dir, ["describe", "--tags", "--long", "--match", "v[0-9]*", ref]).catch(() => null);
  const match = described?.match(/^v(.+)-(\d+)-g[a-f0-9]+$/);
  if (match) return match[2] === "0" ? match[1]! : `${match[1]}+${match[2]}`;
  const date = await git(dir, ["show", "-s", "--format=%cI", ref]).catch(() => "");
  return date ? `Build ${date.replace(/[-:]/g, "").slice(0, 15).replace("T", ".")}` : null;
}

export async function installedVersions(paths: UpdatePaths, git: Git): Promise<UpdateVersions> {
  const [tag, ppclip] = await Promise.all([
    git(paths.app, ["describe", "--tags", "--abbrev=0"]).catch(() => ""),
    paths.packageDir ? versionLabel(paths.packageDir, "HEAD", git) : null,
  ]);
  return {
    paperclip: { current: version(tag), latest: null, updateAvailable: null, compatibility: "unknown" },
    ppclip: { current: ppclip, latest: null, updateAvailable: null },
  };
}

/** Network work runs only on explicit checks, never the recurring status poll. */
export async function checkVersions(paths: UpdatePaths, git: Git, getTree = officialCommitTree, onPaperclipChecked?: () => void): Promise<UpdateVersions> {
  const installed = await installedVersions(paths, git);
  if (paths.packageDir) installed.ppclip.latest = await versionLabel(paths.packageDir, "@{u}", git);
  if (!installed.paperclip.current || !paths.packageDir) return installed;
  try {
    const remote = await git(paths.app, ["ls-remote", "--tags", "origin"], 20_000);
    const latest = latestPaperclipTag(remote, installed.paperclip.current.includes("-"));
    if (!latest) throw new Error("No release tags");
    const { version: label, commit, tag } = latest;
    installed.paperclip.latest = label;
    installed.paperclip.latestTag = tag;
    installed.paperclip.updateAvailable = compareVersions(label, installed.paperclip.current) > 0;
    onPaperclipChecked?.();
    const files = (await git(paths.packageDir, ["ls-tree", "-r", "--name-only", "@{u}", "--", "hooks/"])).split("\n").filter(file => /^hooks\/[^/]+\/manifest\.json$/.test(file));
    if (!files.length || files.length > 100) throw new Error("Support information unavailable");
    const manifests = await Promise.all(files.map(async file => JSON.parse(await git(paths.packageDir!, ["show", `@{u}:${file}`])) as Manifest));
    if (manifests.some(item => item.paperclipCommit === commit)) {
      installed.paperclip.compatibility = "supported";
    } else {
      // Installer also accepts identical trees. A failed tree lookup must not
      // be presented as proof that ppclip has no support for the release.
      const tree = manifests.some(item => item.paperclipTree)
        ? await git(paths.app, ["show", "-s", "--format=%T", commit]).catch(() => getTree(commit)) : null;
      installed.paperclip.compatibility = tree && manifests.some(item => item.paperclipTree === tree) ? "supported" : "waiting";
    }
  } catch {
    installed.paperclip.checkFailed = true;
  }
  return installed;
}

async function officialCommitTree(commit: string) {
  const response = await fetch(`https://api.github.com/repos/paperclipai/paperclip/git/commits/${commit}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "ppclip-updates" }, signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Release information unavailable");
  const data = await response.json() as { tree?: { sha?: string } };
  if (!data.tree?.sha) throw new Error("Release tree unavailable");
  return data.tree.sha;
}
