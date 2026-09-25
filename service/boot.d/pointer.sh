#!/bin/sh
# Re-applies the Magic Remote pointer state last chosen in TV Tools, in case a
# reboot, update or re-pair flipped the setting back.

STATE=/var/lib/tv-tools/pointer

[ -f "$STATE" ] || exit 0
want=$(cat "$STATE")
case "$want" in
	on|off) ;;
	*) exit 0 ;;
esac

# run-parts blocks boot on each hook, so do the waiting in the background.
# settingsservice may not be up yet; retry for up to ~2 minutes.
(
	i=0
	while [ $i -lt 60 ]; do
		cur=$(luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["remotePointer"]}' 2>/dev/null)
		case "$cur" in
			*"\"remotePointer\":\"$want\""*) exit 0 ;;
			*'"returnValue":true'*)
				luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings \
					"{\"category\":\"general\",\"settings\":{\"remotePointer\":\"$want\"}}" >/dev/null 2>&1
				;;
		esac
		i=$((i + 1))
		sleep 2
	done
) </dev/null >/dev/null 2>&1 &
