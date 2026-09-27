#!/bin/sh
# Uninstall cleanup (TV Tools). webOS runs nothing of an app's when it is
# uninstalled, so this watches for TV Tools to disappear and then undoes
# every change TV Tools made, with no restart needed:
#   - the remote key hook and every TV Tools watcher are stopped;
#   - LG's screensaver, home screen rows and background services come back
#     (our bind mounts are removed and LG Home is restarted);
#   - each LG setting TV Tools changed (the pointer, the Leaner LG switches)
#     gets back the value it had before TV Tools first changed it, saved as
#     state orig-<category>.<key>. Settings TV Tools never touched are left alone;
#   - TV Tools' state, boot hook link and log are deleted.
#
# Everything it needs is in this file: once the app is gone, none of its other
# files exist. A running sh keeps reading this file after it is deleted.
#
# An update also removes the app for a moment, so it only acts once the app has
# been gone for GONE_CHECKS checks in a row (30 s). After an update it restarts
# itself on the new copy of this file.
#
# Started by the service and by boot-hook.sh; exits if already running.

ID=io.github.theo78825.tvtools
APP_DIR=/media/developer/apps/usr/palm/applications/$ID
SVC_DIR=/media/developer/apps/usr/palm/services/$ID.service
STATE=/var/lib/tv-tools
HOOK=/var/lib/webosbrew/init.d/tv-tools
PIDFILE=/tmp/tv-tools-uninstall-watch.pid
LOG=/tmp/tv-tools-uninstall.log # RAM: what the cleanup did, until the next restart
GONE_CHECKS=3

if [ -f "$PIDFILE" ] && [ -d "/proc/$(cat "$PIDFILE")" ]; then
	exit 0 # already watching
fi
# The service and run-parts must not wait on us.
if [ "$1" != --run ]; then
	sh "$0" --run </dev/null >/dev/null 2>&1 &
	exit 0
fi
echo $$ > "$PIDFILE"

installed() { [ -d "$APP_DIR" ] || [ -d "$SVC_DIR" ]; }
say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
setting() { luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings "$1" </dev/null >/dev/null 2>&1; }

cleanup() {
	say "TV Tools was uninstalled: putting the TV back"

	# The remote first: killing the key hook hands every button back to LG.
	[ -f /tmp/tv-tools-keyhook.pid ] && kill "$(cat /tmp/tv-tools-keyhook.pid)" 2>/dev/null
	# Every other process still running from the app's folder (the watchers).
	for pid in $(ps -o pid,args | grep "$SVC_DIR/" | grep -v grep | awk '{print $1}'); do
		[ "$pid" = $$ ] || kill "$pid" 2>/dev/null
	done

	# Screensaver: the video-screensaver setting off before our page goes, or
	# LG's online video ads would be the screensaver.
	V=/usr/palm/applications/com.webos.app.videoads
	if grep -q " $V/" /proc/mounts; then
		setting '{"category":"lgchannels","settings":{"isVideoScreenSaverEnabled":false}}'
		for f in index.html app.js; do
			while grep -q " $V/$f " /proc/mounts; do umount "$V/$f" || break; done
		done
		say "screensaver: LG's again"
	fi

	# Home screen rows: LG's layout back, and LG Home restarted to read it.
	A=/usr/palm/applications/com.webos.app.home/data/flutter_assets/assets
	if grep -q " $A/" /proc/mounts; then
		for f in home.xml home_lg.xml; do
			while grep -q " $A/$f " /proc/mounts; do umount "$A/$f" || break; done
		done
		pid=$(pgrep -f '^/usr/bin/flutter-client -i com.webos.app.home' | head -1)
		[ -n "$pid" ] && kill "$pid"
		sleep 3
		pgrep -f '^/usr/bin/flutter-client -i com.webos.app.home' >/dev/null ||
			luna-send -n 1 luna://com.webos.applicationManager/launch \
				'{"id":"com.webos.app.home","preload":"full"}' </dev/null >/dev/null 2>&1
		say "home screen rows: LG's layout again"
	fi

	# LG background services switched off by Leaner LG.
	for svc in acr2 admanager adoverlay-service livepick-plus contentminer color-info-miner uploadd sportsalarm; do
		grep -q " /usr/sbin/$svc " /proc/mounts || continue
		while grep -q " /usr/sbin/$svc " /proc/mounts; do umount "/usr/sbin/$svc" || break; done
		case $svc in contentminer | uploadd)
			systemctl unmask --runtime "$svc.service" >/dev/null 2>&1
			systemctl start "$svc.service" >/dev/null 2>&1
			;;
		esac
		say "service $svc: back on"
	done

	# LG settings: each back to the value it had before TV Tools changed it.
	for f in "$STATE"/orig-*.*; do
		[ -f "$f" ] || continue
		name=${f##*/orig-}
		category=${name%%.*}
		key=${name#*.}
		setting "{\"category\":\"$category\",\"settings\":{\"$key\":$(cat "$f")}}"
		say "setting $category.$key: back to $(cat "$f")"
	done

	# Nothing of TV Tools left behind. The hook is only removed if it's our link.
	[ -L "$HOOK" ] && case "$(readlink "$HOOK")" in "$SVC_DIR"/*) rm -f "$HOOK" ;; esac
	rm -rf "$STATE" /var/log/tv-tools.log /var/lib/webosbrew/tv-tools.log
	for f in /tmp/tv-tools-*; do
		[ "$f" = "$LOG" ] || [ "$f" = "$PIDFILE" ] || rm -rf "$f"
	done
	say "done"
}

self=$(stat -c %Y "$0" 2>/dev/null)
gone=0
while :; do
	sleep 10
	if installed; then
		gone=0
		# Updated: carry on as the new copy of this file.
		now=$(stat -c %Y "$0" 2>/dev/null)
		if [ -n "$now" ] && [ "$now" != "$self" ]; then
			rm -f "$PIDFILE"
			exec sh "$0" --run
		fi
		continue
	fi
	gone=$((gone + 1))
	[ $gone -ge $GONE_CHECKS ] || continue
	cleanup
	rm -f "$PIDFILE"
	exit 0
done
