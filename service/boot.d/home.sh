#!/bin/sh
# Re-applies the home screen layout saved by TV Tools (features/home.js).
# Patched copies live in STORE; they are bind-mounted over LG's files, which
# are never modified. Skips any file whose stock SHA-256 no longer matches.
# Watchdog: if Home keeps crashing with the layout, unmount everything and
# move STORE aside so the next boot is stock too. It waits with no time limit
# for Home's first start: the TV reboots itself overnight in standby (seen at
# ~03:26), and Home doesn't start until the screen is turned on.

ASSETS=/usr/palm/applications/com.webos.app.home/data/flutter_assets/assets
STORE=/var/lib/tv-tools/home
HOME_PROC='^/usr/bin/flutter-client -i com.webos.app.home'

[ -d "$STORE" ] || exit 0

mounted=0
for f in home.xml home_lg.xml; do
	[ -f "$STORE/$f" ] && [ -f "$STORE/$f.sha256" ] || continue
	want=$(cat "$STORE/$f.sha256")
	have=$(sha256sum "$ASSETS/$f" | cut -d' ' -f1)
	[ "$want" = "$have" ] || continue
	mount --bind "$STORE/$f" "$ASSETS/$f" && mounted=1
done
[ $mounted = 1 ] || exit 0

undo() {
	for f in home.xml home_lg.xml; do
		umount "$ASSETS/$f" 2>/dev/null
	done
	rm -rf "$STORE.disabled"
	mv "$STORE" "$STORE.disabled"
	pid=$(pgrep -f "$HOME_PROC" | head -1)
	[ -n "$pid" ] && kill "$pid"
}

# run-parts blocks boot on each hook, so do the waiting in the background.
(
	# If Home already started before this hook, restart it to read the layout.
	# webOS only respawns it by itself while it is in front, so preload it too.
	pid=$(pgrep -f "$HOME_PROC" | head -1)
	if [ -n "$pid" ]; then
		kill "$pid"
		sleep 3
		pgrep -f "$HOME_PROC" >/dev/null || luna-send -n 1 luna://com.webos.applicationManager/launch \
			'{"id":"com.webos.app.home","preload":"full"}' </dev/null >/dev/null 2>&1
	fi

	# Wait (however long standby lasts) for Home to start.
	until pgrep -f "$HOME_PROC" >/dev/null; do
		sleep 5
	done

	# Then watch it for 3 minutes: a layout that crashes Home shows up as the
	# process being replaced again and again. 4+ different processes = undo.
	seen=""
	i=0
	while [ $i -lt 36 ]; do
		pid=$(pgrep -f "$HOME_PROC" | head -1)
		if [ -n "$pid" ]; then
			case " $seen " in
				*" $pid "*) ;;
				*) seen="$seen $pid" ;;
			esac
		fi
		if [ $(echo $seen | wc -w) -ge 4 ]; then
			undo
			exit 0
		fi
		i=$((i + 1))
		sleep 5
	done
) </dev/null >/dev/null 2>&1 &
