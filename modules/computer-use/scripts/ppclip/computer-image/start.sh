#!/bin/sh
# ppclip computer: start the desktop, the streams and the control daemon.
# Runs as root with only SETUID/SETGID/KILL; every service drops to "agent" (1000).
set -eu
W="${SCREEN_WIDTH:-1280}"; H="${SCREEN_HEIGHT:-800}"
AS_AGENT="setpriv --reuid=1000 --regid=1000 --init-groups"
RUN=/tmp/ppclip

# Private runtime folder (0700, agent only): X cookie, VNC sockets, stream tokens.
$AS_AGENT sh -c "mkdir -p $RUN/tokens /home/agent/Downloads /home/agent/chromium-profile && chmod 700 $RUN $RUN/tokens"
# The shell runner's socket folder (root-owned; the runner checks the caller's uid).
mkdir -p /tmp/ppclip-shell && chmod 711 /tmp/ppclip-shell

# X display protected by a cookie, so the sandbox shell user cannot inject input.
COOKIE="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
$AS_AGENT sh -c "touch $RUN/Xauthority && chmod 600 $RUN/Xauthority && xauth -f $RUN/Xauthority add :1 . $COOKIE"
export XAUTHORITY="$RUN/Xauthority" HOME=/home/agent

$AS_AGENT Xvfb :1 -screen 0 "${W}x${H}x24" -dpi 96 -auth "$RUN/Xauthority" -nolisten tcp -noreset +extension RANDR >/dev/null 2>&1 &
for _ in $(seq 1 100); do $AS_AGENT xdpyinfo -display :1 >/dev/null 2>&1 && break; sleep 0.1; done
$AS_AGENT openbox >/dev/null 2>&1 &

# Egress filter for the browser: blocks private, local and cloud-metadata addresses.
$AS_AGENT python3 /opt/ppclip/egress_proxy.py >/dev/null 2>&1 &

# Always-on view-only stream on a private Unix socket. The interactive stream
# is started by the control daemon only while a person holds control.
$AS_AGENT x11vnc -display :1 -rfbport 0 -unixsock "$RUN/view.sock" -viewonly -shared -forever -nopw -quiet -noxdamage >/dev/null 2>&1 &
# One gateway for both streams. Each live token maps to one stream socket; no token, no connection.
$AS_AGENT websockify --web=/usr/share/novnc --token-plugin=TokenFile --token-source="$RUN/tokens" 0.0.0.0:6080 >/dev/null 2>&1 &

# Shell commands (only when enabled for the agent) run as "sandbox" (1001).
if [ "${PPCLIP_SHELL:-0}" = "1" ]; then
  python3 /opt/ppclip/shell_runner.py >/dev/null 2>&1 &
fi

# The control daemon also launches and supervises Chromium (debugging over a pipe, never a port).
exec $AS_AGENT python3 /opt/ppclip/control.py
