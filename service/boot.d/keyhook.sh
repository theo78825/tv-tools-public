#!/bin/sh
# Remote key hook (TV Tools, features/keyhook.js) at boot: start it if it was left
# on. It resolves the remote's input devices by name, so it must run after
# lginput2 has created them; the service also starts it when it next loads, so a
# miss here is not fatal. Forks, so run-parts doesn't wait.
[ "$(cat /var/lib/tv-tools/key-hook 2>/dev/null)" = on ] || exit 0
D=$(dirname "$0")/..
(
	i=0
	until grep -q 'LGE M-RCU - Builtin \[1\]' /proc/bus/input/devices; do
		i=$((i + 1))
		[ $i -gt 60 ] && exit 0
		sleep 5
	done
	python3 "$D/key-hook.py"
) </dev/null >/dev/null 2>&1 &
