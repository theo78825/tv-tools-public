#!/bin/sh
# Bouncing-ball screensaver on or off (TV Tools, features/screensaver.js).
#   screensaver-apply.sh on    show ours as the TV's screensaver
#   screensaver-apply.sh off   back to LG's own
#
# How: tvpowerd launches one of two LG apps as the screensaver. Normally that's
# com.webos.app.screensaver (compiled Flutter, the clock). With the LG setting
# lgchannels.isVideoScreenSaverEnabled it's com.webos.app.videoads instead: a
# two-file web app (index.html, app.js) that only redirects to LG's online video
# ads. We bind-mount our page (saver/) over those two files, from a copy in /tmp,
# and switch that setting on. LG then launches, wakes and closes our page exactly
# as it does its own screensaver. LG's files are never written; a reboot removes
# the mounts.
#
# The setting must never be on without our page mounted, or the screensaver
# would be LG's video ads. So "on" mounts first and only then sets it, "off"
# clears it first, boot.d/screensaver.sh runs "off" before anything else, and
# the mount only goes over the exact files it was tested on (SHA-256).

V=/usr/palm/applications/com.webos.app.videoads
SRC=$(dirname "$0")/saver
COPY=/tmp/tv-tools-saver
# Stock videoads on 33.31.69 (build 10.3.1-3007), recorded 2026-09-25.
SHA_INDEX=6339e471306dea6e191e5401d91ff13a5b9501616bb5b478ccf8f3c662374baf
SHA_APP=bb28d14353732b134f9580b1087f18efb48fc80eb887fc5d65e43c531127800d

# Only this key. LG's dmost (the LG Channels service) owns it and recomputes it
# (to false, with LG Channels off) whenever one of its inputs changes; writing
# videoScreenSaverDisabledByError is one of those, so it undid ours within 3 ms.
# It can still recompute later (network, foreground app), so screensaver-watch.sh
# puts it back.
video_saver() {
	luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings \
		"{\"category\":\"lgchannels\",\"settings\":{\"isVideoScreenSaverEnabled\":$1}}" \
		</dev/null >/dev/null 2>&1
}
mounted() { grep -q " $V/$1 " /proc/mounts; }
unmount() {
	for f in index.html app.js; do
		while mounted $f; do umount "$V/$f" || break; done
	done
}

case "$1" in
off)
	video_saver false
	unmount
	echo off
	;;
on)
	video_saver false
	unmount # a deploy may bring a new page; always mount the current one
	if [ "$(sha256sum "$V/index.html" | cut -d' ' -f1)" != $SHA_INDEX ] ||
		[ "$(sha256sum "$V/app.js" | cut -d' ' -f1)" != $SHA_APP ]; then
		echo "LG's videoads app isn't the tested version; leaving LG's screensaver" >&2
		exit 1
	fi
	rm -rf "$COPY"
	mkdir -p "$COPY"
	cp "$SRC/index.html" "$SRC/app.js" "$COPY/" || exit 1
	if mount --bind "$COPY/index.html" "$V/index.html" && mount --bind "$COPY/app.js" "$V/app.js"; then
		video_saver true
		echo on
	else
		unmount
		echo "mount failed; leaving LG's screensaver" >&2
		exit 1
	fi
	;;
*)
	echo "usage: $0 on|off" >&2
	exit 2
	;;
esac
