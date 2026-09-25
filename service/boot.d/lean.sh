#!/bin/sh
# Leaner LG (TV Tools, features/lean.js) at boot.
# 1. Once LG's settings service answers, wait a minute more, so the system has
#    fully started (the state the services were tested in), then call applyLean:
#    it overlays the saved LG services again (only on the tested firmware) and
#    switches off again any LG setting LG turned back on.
#    Then start lean-watch.sh, which keeps switching them off while the TV runs.
# 2. Watchdog for 10 minutes: if switched-off services are being relaunched in a
#    storm (more than 100 attempts in 30 s; stopping one causes a one-off burst of
#    up to ~30), put them all back on and forget them (undoLeanServices), and the
#    card says why. No checks on other LG
#    processes: the TV also reboots itself in standby, where LG Home and others
#    never start (see the home-rows watchdog in boot.d/home.sh).

S=/var/lib/tv-tools
[ -s $S/lean-off ] || [ -s $S/lean-services-off ] || exit 0
SVC=luna://io.github.theo78825.tvtools.service
LOG=/tmp/tv-tools-lean/launches.log

# run-parts blocks boot on each hook, so do the waiting in the background.
(
	i=0
	until luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["adCookie"]}' </dev/null 2>/dev/null | grep -q '"returnValue":true'; do
		i=$((i + 1))
		[ $i -gt 60 ] && exit 0
		sleep 10
	done
	sleep 60

	i=0
	until r=$(luna-send -n 1 $SVC/applyLean '{}' </dev/null 2>/dev/null) && case "$r" in *'"returnValue":true'*) true ;; *) false ;; esac; do
		i=$((i + 1))
		[ $i -gt 30 ] && exit 0
		sleep 10
	done
	# Keep watching the switches: LG also turns some back on at power-on.
	sh "$(dirname "$0")/../lean-watch.sh"
	case "$r" in *'"services":[]'*) exit 0 ;; esac # no services overlaid: nothing to watch

	n=0
	while [ $n -lt 20 ]; do # 20 x 30 s = 10 minutes
		before=$(cat $LOG 2>/dev/null | wc -l)
		sleep 30
		after=$(cat $LOG 2>/dev/null | wc -l)
		if [ $((after - before)) -gt 100 ]; then
			luna-send -n 1 $SVC/undoLeanServices '{"reason":"LG kept restarting a switched-off service"}' </dev/null >/dev/null 2>&1
			exit 0
		fi
		n=$((n + 1))
	done
) </dev/null >/dev/null 2>&1 &
