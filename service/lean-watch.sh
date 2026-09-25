#!/bin/sh
# Leaner LG switch watcher (TV Tools, features/lean.js). LG turns some switches
# back on while the TV is running, not just at boot: at power-on on 2026-09-25,
# com.webos.pmlogd set option.dbgLogUpload back to true. This subscribes to the
# two settings categories the switches live in, and on every change calls
# applyLean {reason: "watch"}, which switches off again anything that was switched
# off here and logs it (state lean-log). Started by boot.d/lean.sh and by the service
# (init and setLeanSwitch); exits if already running or nothing is switched off.

STATE=/var/lib/tv-tools/lean-off
PIDFILE=/tmp/tv-tools-lean/watch.pid
SVC=luna://io.github.theo78825.tvtools.service

[ -s "$STATE" ] || exit 0
if [ -f "$PIDFILE" ] && [ -d "/proc/$(cat "$PIDFILE")" ]; then
	exit 0 # already watching
fi
# The service and run-parts must not wait on us.
if [ "$1" != --run ]; then
	sh "$0" --run </dev/null >/dev/null 2>&1 &
	exit 0
fi
mkdir -p /tmp/tv-tools-lean
echo $$ > "$PIDFILE"

watch() {
	while [ -s "$STATE" ]; do
		luna-send -i luna://com.webos.settingsservice/getSystemSettings "{\"category\":\"$1\",\"subscribe\":true}" </dev/null 2>/dev/null |
			while read -r line; do
				[ -s "$STATE" ] || exit 0
				luna-send -n 1 "$SVC/applyLean" '{"reason":"watch"}' </dev/null >/dev/null 2>&1
				sleep 1 # never a tight loop, even if LG fights back
			done
		sleep 5
	done
}

watch option &
watch general
wait
rm -f "$PIDFILE"
