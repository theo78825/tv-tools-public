#!/bin/sh
# Screensaver (TV Tools, features/screensaver.js) at boot. Does nothing unless
# the screensaver card has been used. The mounts are gone after a restart but
# LG's video-screensaver setting isn't, so switch that off first (else LG's
# online video ads would be the screensaver), then put our page back if the
# bouncing ball is on. Then start the watcher that turns the TV off after hours
# of screensaver; it forks, so run-parts doesn't wait.
S=/var/lib/tv-tools
[ -f $S/screensaver ] || [ -f $S/screensaver-off-hours ] || exit 0
D=$(dirname "$0")/..
sh "$D/screensaver-apply.sh" off
[ "$(cat $S/screensaver 2>/dev/null)" = on ] && sh "$D/screensaver-apply.sh" on
sh "$D/screensaver-watch.sh"
