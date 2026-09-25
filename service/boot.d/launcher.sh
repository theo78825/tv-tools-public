#!/bin/sh
# Home-button redirect (TV Tools, features/launcher.js). Watches the foreground
# app; when LG Home comes to the front, opens our home screen instead (TV Tools
# launched with {"view":"home"}). LG's home app and the Home key are never modified.
#
# Loop guard: if our Home never reaches the front across 3 redirects in a row,
# or there are more than 10 redirects in a minute, turn the redirect off (the
# state file says "off" and TRIPPED records why), so LG Home just works again.

# Paths can be overridden for testing (see README).
STATE=${REDIRECT_STATE:-/var/lib/tv-tools/redirect}
TRIPPED=${REDIRECT_TRIPPED:-/var/lib/tv-tools/redirect-tripped}
PIDFILE=${REDIRECT_PIDFILE:-/tmp/tv-tools-redirect.pid}
PAUSE=${REDIRECT_PAUSE:-/tmp/tv-tools-redirect-pause}
APP_DIR=/media/developer/apps/usr/palm/applications/io.github.theo78825.tvtools
AM=luna://com.webos.applicationManager

enabled() { [ "$(cat "$STATE" 2>/dev/null)" = on ] && [ -d "$APP_DIR" ]; }

enabled || exit 0
if [ -f "$PIDFILE" ] && [ -d "/proc/$(cat "$PIDFILE")" ]; then
	exit 0 # already watching
fi

# run-parts (and the TV Tools service) must not wait on us.
if [ "$1" != --run ]; then
	sh "$0" --run </dev/null >/dev/null 2>&1 &
	exit 0
fi
echo $$ > "$PIDFILE"

trip() {
	echo off > "$STATE"
	echo "$(date '+%Y-%m-%d %H:%M'): $1" > "$TRIPPED"
}

while enabled; do
	luna-send -i "$AM/getForegroundAppInfo" '{"subscribe":true}' </dev/null 2>/dev/null | {
		misses=0 # redirects since our Home was last seen in front
		recent="" # timestamps of redirects in the last minute
		while read -r line; do
			enabled || exit 0
			case "$line" in
				*'"appId":"io.github.theo78825.tvtools"'*)
					misses=0
					continue
					;;
				*'"appId":"com.webos.app.home"'*) ;;
				*'"appId":""'*) continue ;;
				*'"appId":'*)
					rm -f "$PAUSE" # any other app ends an "LG Home" pause
					continue
					;;
				*) continue ;;
			esac
			[ -f "$PAUSE" ] && continue

			now=$(date +%s)
			kept=""
			for t in $recent; do
				[ $((now - t)) -lt 60 ] && kept="$kept $t"
			done
			recent="$kept $now"
			misses=$((misses + 1))
			if [ $misses -gt 3 ]; then
				trip "Home did not open after 3 redirects in a row"
				exit 0
			fi
			if [ $(echo $recent | wc -w) -gt 10 ]; then
				trip "more than 10 redirects in a minute"
				exit 0
			fi
			luna-send -n 1 "$AM/launch" '{"id":"io.github.theo78825.tvtools","params":{"view":"home"}}' </dev/null >/dev/null 2>&1
		done
	}
	sleep 2
done
rm -f "$PIDFILE"
