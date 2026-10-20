#!/bin/sh
# ppclip computer: start the desktop, the streams and the control daemon.
# Root configures egress, then drops NET_ADMIN/SETPCAP before starting services.
set -eu
if [ "${PPCLIP_NETWORK_READY:-0}" != "1" ]; then
  python3 /opt/ppclip/network_policy.py
  export PPCLIP_NETWORK_READY=1
  # Drop bootstrap capabilities from PID 1 and every subsequent service.
  exec setpriv --bounding-set=-net_admin,-setpcap /usr/bin/tini -- /opt/ppclip/start.sh
fi
W="${SCREEN_WIDTH:-1280}"; H="${SCREEN_HEIGHT:-800}"
AS_AGENT="setpriv --reuid=1000 --regid=1000 --init-groups"
RUN=/tmp/ppclip

# Private runtime folder (0700, agent only): X cookie, VNC sockets, stream tokens.
$AS_AGENT sh -c "mkdir -p $RUN/tokens /home/agent/Downloads /home/agent/chromium-profile && chmod 700 $RUN $RUN/tokens"
# The shell runner's socket folder (root-owned; the runner checks the caller's uid).
mkdir -p /tmp/ppclip-shell && chmod 711 /tmp/ppclip-shell

# A stopped container keeps /tmp. Old X lock PIDs may now belong to another
# process, and old Unix sockets prevent Xvfb/VNC from binding after restart.
# This container owns display :1; no display service has been started yet.
$AS_AGENT rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 "$RUN/view.sock" "$RUN/control.sock"

# X display protected by a cookie, so the sandbox shell user cannot inject input.
COOKIE="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
$AS_AGENT sh -c "touch $RUN/Xauthority && chmod 600 $RUN/Xauthority && xauth -f $RUN/Xauthority add :1 . $COOKIE"
export XAUTHORITY="$RUN/Xauthority" HOME=/home/agent
export DBUS_SESSION_BUS_ADDRESS="$($AS_AGENT dbus-daemon --session --fork --print-address)"
$AS_AGENT sh -c 'printf %s "$DBUS_SESSION_BUS_ADDRESS" > /tmp/ppclip/dbus-address'
export NO_AT_BRIDGE=0 GTK_MODULES=atk-bridge

$AS_AGENT Xvfb :1 -screen 0 "${W}x${H}x24" -dpi 96 -auth "$RUN/Xauthority" -nolisten tcp -noreset +extension RANDR >/dev/null 2>&1 &
for _ in $(seq 1 100); do $AS_AGENT xdpyinfo -display :1 >/dev/null 2>&1 && break; sleep 0.1; done
# Never launch a healthy-looking control daemon over a missing desktop.
$AS_AGENT xdpyinfo -display :1 >/dev/null 2>&1 || { echo "X display did not become ready" >&2; exit 1; }
$AS_AGENT openbox >/dev/null 2>&1 &
$AS_AGENT hsetroot -fill /opt/ppclip/wallpaper.png >/dev/null 2>&1
# Openbox alone has no taskbar: minimized windows would leave an empty desktop.
# Use a fixed config outside the persistent profile so every session can recover them.
$AS_AGENT sh -c 'exec tint2 -c /opt/ppclip/tint2rc >/tmp/ppclip/tint2.log 2>&1' &
if [ "${PPCLIP_DESKTOP_DRIVER:-atspi}" = "cua" ]; then
  [ -x /opt/cua/cua-driver ] || { echo "Rebuild the computer image with build-image --with-cua" >&2; exit 1; }
  export CUA_DRIVER_RS_TELEMETRY_ENABLED=false
  $AS_AGENT sh -c 'exec /opt/cua/cua-driver serve --socket /tmp/ppclip/cua.sock --no-overlay --permission-mode bounded --capability-manifest /opt/ppclip/cua-read-only.yaml --approve-capability-manifest >/tmp/ppclip/cua.log 2>&1' &
fi

# Egress filter for the browser: blocks private, local and cloud-metadata addresses.
setpriv --reuid=1002 --regid=1002 --clear-groups python3 /opt/ppclip/egress_proxy.py >/dev/null 2>&1 &

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
