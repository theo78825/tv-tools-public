#!/bin/sh
# Screensaver auto-off (TV Tools, features/screensaver.js). Checks the TV's power
# state every 5 s and turns the TV off once it has been in the screensaver for
# `screensaver-off-hours` hours ("off" or unset = never), with the call LG's
# own Auto Power Off makes (tvpower power2/powerOff, reason autoOff). Only while
# the state reads "Screen Saver", so a film being watched is never cut off.
# (Which screensaver shows, ours or LG's, is screensaver-apply.sh's job; LG
# launches and closes it by itself.)
#
# It also keeps LG's video-screensaver setting in step with our page
# (guard_setting). While the screensaver is up, UP exists: key-hook.py reads it to wake the
# TV for the buttons it claims, which never reach the screensaver.
#
# Started at boot (boot.d/screensaver.sh) and by the service; exits if already
# running, and when both the ball and auto-off are switched off. A deploy replaces this file, and the
# running copy then restarts itself on the new one.

SAVER_STATE=/var/lib/tv-tools/screensaver
HOURS_STATE=/var/lib/tv-tools/screensaver-off-hours
LAST_OFF=/var/lib/tv-tools/screensaver-last-off
PIDFILE=/tmp/tv-tools-saver-watch.pid
SINCE=/tmp/tv-tools-saver-since # epoch s the current screensaver spell began
UP=/tmp/tv-tools-saver-up       # exists while the screensaver is on (key-hook.py reads it)
POWER=luna://com.webos.service.tvpower

hours() {
	h=$(cat "$HOURS_STATE" 2>/dev/null)
	case "$h" in '' | off | *[!0-9]*) echo 0 ;; *) echo "$h" ;; esac
}
# Runs while either is on: the ball needs UP for key-hook.py.
wanted() { [ "$(cat "$SAVER_STATE" 2>/dev/null)" = on ] || [ "$(hours)" -gt 0 ]; }
V=/usr/palm/applications/com.webos.app.videoads
FIXES=/tmp/tv-tools-saver-fixes # how often the setting had to be put back
video_saver() { luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings '{"category":"lgchannels","keys":["isVideoScreenSaverEnabled"]}' </dev/null | sed -n 's/.*"isVideoScreenSaverEnabled": *\([a-z]*\).*/\1/p'; }
set_video_saver() {
	luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings "{\"category\":\"lgchannels\",\"settings\":{\"isVideoScreenSaverEnabled\":$1}}" </dev/null >/dev/null 2>&1
	echo $(($(cat "$FIXES" 2>/dev/null || echo 0) + 1)) > "$FIXES"
}
# LG's video-screensaver setting must be on exactly while our page is mounted
# over videoads: LG's dmost resets it to off now and then, and on without our
# page LG's online video ads would be the screensaver.
guard_setting() {
	if grep -q " $V/index.html " /proc/mounts && grep -q " $V/app.js " /proc/mounts; then
		[ "$(cat "$SAVER_STATE" 2>/dev/null)" = on ] && [ "$(video_saver)" = false ] && set_video_saver true
	elif [ "$(video_saver)" = true ]; then
		set_video_saver false
	fi
}
power_state() { luna-send -n 1 "$POWER/power/getPowerState" '{}' </dev/null | sed -n 's/.*"state": *"\([^"]*\)".*/\1/p'; }

wanted || exit 0
if [ -f "$PIDFILE" ] && [ -d "/proc/$(cat "$PIDFILE")" ]; then
	exit 0 # already watching
fi
# The service and run-parts must not wait on us.
if [ "$1" != --run ]; then
	sh "$0" --run </dev/null >/dev/null 2>&1 &
	exit 0
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE" "$UP"' EXIT
trap 'exit 0' TERM INT

entered() {
	date +%s > "$SINCE"
	touch "$UP"
}

left() {
	rm -f "$UP" "$SINCE"
}

self=$(stat -c %Y "$0")
was=""
while wanted; do
	if [ "$(stat -c %Y "$0" 2>/dev/null)" != "$self" ]; then
		rm -f "$PIDFILE"
		trap - EXIT
		[ -f "$0" ] && exec sh "$0" --run
		exit 0 # uninstalled
	fi
	[ "$was" = "Screen Saver" ] || guard_setting # (tvpowerd reads it as the screensaver starts)
	now_state=$(power_state)
	if [ -n "$now_state" ] && [ "$now_state" != "$was" ]; then
		if [ "$now_state" = "Screen Saver" ]; then
			entered
		elif [ "$was" = "Screen Saver" ]; then
			left
		fi
		was=$now_state
	fi
	# Time to turn off? Checked every pass, so a wake at the last second wins.
	h=$(hours)
	if [ "$was" = "Screen Saver" ] && [ "$h" -gt 0 ] && [ -s "$SINCE" ] &&
		[ $(($(date +%s) - $(cat "$SINCE"))) -ge $((h * 3600)) ]; then
		echo "$(date +%s) $h" > "$LAST_OFF"
		rm -f "$SINCE" "$UP"
		luna-send -n 1 "$POWER/power2/powerOff" '{"reason":"autoOff"}' </dev/null >/dev/null 2>&1
		was=""
		sleep 10
	fi
	sleep 5
done
