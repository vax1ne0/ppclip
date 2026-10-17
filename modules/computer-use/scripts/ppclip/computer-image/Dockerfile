# ppclip computer: one sandboxed Linux desktop + Chromium per agent.
# Built by: node scripts/ppclip/computer-supervisor.mjs build-image
# Ideas from rakazo (Apache-2.0), connbot/desktop-bridge (Apache-2.0) and
# anthropic computer-use-demo (MIT); no code copied.
FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb xauth x11vnc openbox xterm xdotool x11-utils imagemagick util-linux \
      novnc websockify python3 chromium fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
      ca-certificates dbus-x11 procps tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home --home-dir /home/agent --shell /bin/bash agent \
    && useradd --uid 1001 --create-home --home-dir /home/sandbox --shell /bin/bash sandbox

# Chromium policy: no Google sign-in or sync, no saved passwords, no local files.
COPY chromium-policy.json /etc/chromium/policies/managed/ppclip.json
COPY start.sh control.py egress_proxy.py shell_runner.py /opt/ppclip/
# Windows checkouts with core.autocrlf=true add CRLF; a CRLF shebang cannot run on Linux.
RUN sed -i 's/\r$//' /opt/ppclip/* /etc/chromium/policies/managed/ppclip.json \
    && chmod 0755 /opt/ppclip/*.sh /opt/ppclip/*.py \
    && chmod -R a-w /usr/share/novnc /opt/ppclip /etc/chromium/policies

# The container starts as root with every capability dropped except SETUID,
# SETGID and KILL (set by the supervisor), only so start.sh can run the desktop
# as "agent" (1000) and shell commands as "sandbox" (1001). Nothing keeps root.
ENV DISPLAY=:1 SCREEN_WIDTH=1280 SCREEN_HEIGHT=800
WORKDIR /home/agent
EXPOSE 7070 6080
HEALTHCHECK --interval=15s --timeout=3s CMD python3 -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:7070/ping', timeout=2)" || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/ppclip/start.sh"]
