#!/bin/sh
# TV Tools (io.github.theo78825.tvtools) boot hook. The service symlinks this
# file into /var/lib/webosbrew/init.d, which Homebrew Channel runs once per boot.
# It's a symlink, not a copy: uninstalling the app removes this file, the link
# breaks, and nothing of TV Tools runs at boot any more.
#
# It runs each feature's boot script from the installed app, so updating the
# app updates the boot behaviour. Each boot script does nothing unless its card
# was used, and checks what it acts on before touching it.
# What ran is written to LOG, replaced every boot.

SERVICE_DIR=/media/developer/apps/usr/palm/services/io.github.theo78825.tvtools.service
LOG=/var/lib/webosbrew/tv-tools.log

[ -d "$SERVICE_DIR/boot.d" ] || exit 0

exec >"$LOG" 2>&1 </dev/null
echo "$(date '+%Y-%m-%d %H:%M:%S') TV Tools boot hook"

# /tmp is RAM, so this mark means "ran this boot" (read by features/health.js).
date +%s > /tmp/tv-tools-boot

# Puts the TV back without a restart if TV Tools is uninstalled.
sh "$SERVICE_DIR/uninstall-watch.sh"
echo "uninstall-watch.sh: started"

for f in "$SERVICE_DIR"/boot.d/*.sh; do
	[ -f "$f" ] || continue
	sh "$f"
	echo "$(basename "$f"): exit $?"
done
exit 0
