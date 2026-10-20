# Computer-use experiments

These are opt-in experiments, separate from the production viewer and agent control service. Steel and E2B are outside this run's scope.

## Neko viewer

The Compose file pins the reviewed image digest, publishes HTTP/media on loopback only, uses temporary credentials, and mounts no host files or persistent profiles. It does not integrate Neko's control ownership with ppclip's leases; do not point production agents at it.

From the package root, set `PPCLIP_NEKO_PASSWORD` and `PPCLIP_NEKO_ADMIN_PASSWORD` to two different temporary values in your shell, then:

```bash
docker compose -p ppclip-neko-experiment -f tools/experiments/neko.compose.yml up -d
```

Open http://127.0.0.1:7093. Compare first-frame time, reconnect, CPU/memory, and input responsiveness with the existing viewer on the same host. WebRTC connection statistics do not measure total click-to-display latency. This Firefox fixture is not a matched browser-task benchmark against ppclip's Chromium.

Remove only this experiment when finished:

```bash
docker compose -p ppclip-neko-experiment -f tools/experiments/neko.compose.yml down
```

Production adoption still requires ppclip-owned authentication, read-only enforcement, lease revocation, private takeover, and a viewer transport adapter. noVNC remains the default.

Local check on 2026-10-19: the pinned fixture displayed live Firefox frames and accepted a control claim plus address-bar navigation through streamed input. The container/network were removed afterward. This establishes basic functionality only; a matched latency/resource benchmark is still outstanding.

## CUA observation backend

The optional image build pins MIT CUA Driver 0.35.4 and verifies its archive SHA-256. It includes neither Spaces nor the perception extension. The driver runs inside the agent's Linux desktop with telemetry disabled and a bounded, read-only tool/application manifest. ppclip performs input through its existing checks, not CUA's unrestricted input API.

See [computer use](../../docs/computer-use.md) for build and startup commands. The default native observer remains the smaller AT-SPI bridge. CUA is currently limited to Linux x86_64 and the manifest's packaged Chromium, Python GTK and xterm applications; other apps may return no accessible controls. Restart a desktop after the 24-hour observation-manifest lifetime expires.
