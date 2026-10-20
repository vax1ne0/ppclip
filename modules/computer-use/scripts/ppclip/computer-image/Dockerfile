# ppclip computer: one sandboxed Linux desktop + Chromium per agent.
# Built by: node scripts/ppclip/computer-supervisor.mjs build-image
# Ideas from rakazo (Apache-2.0), connbot/desktop-bridge (Apache-2.0) and
# anthropic computer-use-demo (MIT); no code copied.
FROM debian:bookworm-slim
LABEL ppclip.sandbox-policy="2"

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb xauth x11vnc openbox xterm xdotool x11-utils imagemagick util-linux \
      novnc websockify python3 chromium fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
      ca-certificates dbus-x11 procps tini iptables chromium-sandbox \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home --home-dir /home/agent --shell /bin/bash agent \
    && useradd --uid 1001 --create-home --home-dir /home/sandbox --shell /bin/bash sandbox \
    && useradd --uid 1002 --no-create-home --shell /usr/sbin/nologin ppclip-proxy

# Keep desktop additions separate so updates reuse the Chromium image layer.
RUN apt-get update && apt-get install -y --no-install-recommends tint2 \
    && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends python3-pyatspi at-spi2-core python3-gi gir1.2-gtk-3.0 hsetroot librsvg2-bin \
    && rm -rf /var/lib/apt/lists/*

# Chromium policy: no Google sign-in or sync, no saved passwords, no local files.
COPY chromium-policy.json /etc/chromium/policies/managed/ppclip.json
COPY start.sh control.py egress_proxy.py shell_runner.py /opt/ppclip/
COPY network_policy.py browser_runtime.py /opt/ppclip/
COPY profile_archive.py /opt/ppclip/
COPY desktop_accessibility.py desktop_tools.py /opt/ppclip/
COPY cua_observation.py cua-read-only.yaml install_cua.py CUA-LICENSE.txt /opt/ppclip/
ARG PPCLIP_WITH_CUA=0
RUN if [ "$PPCLIP_WITH_CUA" = "1" ]; then python3 /opt/ppclip/install_cua.py; fi
LABEL ppclip.cua-driver="$PPCLIP_WITH_CUA"
COPY tint2rc chromium-managed.desktop browser_launcher.py wallpaper.svg /opt/ppclip/
RUN rsvg-convert -o /opt/ppclip/wallpaper.png /opt/ppclip/wallpaper.svg
# Windows checkouts with core.autocrlf=true add CRLF; a CRLF shebang cannot run on Linux.
RUN sed -i 's/\r$//' /opt/ppclip/*.sh /opt/ppclip/*.py /opt/ppclip/*.yaml /opt/ppclip/*.txt \
      /opt/ppclip/*.desktop /opt/ppclip/tint2rc /etc/chromium/policies/managed/ppclip.json \
    && chmod 0755 /opt/ppclip/*.sh /opt/ppclip/*.py \
    && chmod -R a-w /usr/share/novnc /opt/ppclip /etc/chromium/policies

# Bootstrap briefly has NET_ADMIN/SETPCAP to install egress rules, then removes
# both before tini/services start. SETUID/SETGID/KILL support the separate agent,
# shell and proxy users. The root shell broker retains only those three.
ENV DISPLAY=:1 SCREEN_WIDTH=1280 SCREEN_HEIGHT=800
WORKDIR /home/agent
EXPOSE 7070 6080
HEALTHCHECK --interval=15s --timeout=3s CMD python3 -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:7070/ping', timeout=2)" || exit 1
ENTRYPOINT ["/opt/ppclip/start.sh"]
