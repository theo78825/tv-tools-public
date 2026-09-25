#!/bin/sh
# Build TV Tools and install it on a rooted webOS TV, then elevate its service.
#   tools/deploy.sh root@TV_IP
# Uses SSH keys by default; export SSHPASS=... to use a password via sshpass.
set -eu

TARGET=${1:?usage: tools/deploy.sh root@TV_IP}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['id'])" "$ROOT/app/appinfo.json")
SVC_ID=$APP_ID.service
HB=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service

tv() {
	if [ -n "${SSHPASS:-}" ]; then
		sshpass -e ssh -o PubkeyAuthentication=no "$TARGET" "$@"
	else
		ssh "$TARGET" "$@"
	fi
}

IPK=$(python3 "$ROOT/tools/build.py")
echo "built $IPK"

tv "cat > /tmp/tvtools.ipk" < "$IPK"

echo "installing..."
# appInstallService cancels the job if the subscriber disconnects, so stay
# subscribed until it reports "installed" (or an error).
tv "luna-send -i luna://com.webos.appInstallService/dev/install \
	'{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/tmp/tvtools.ipk\",\"subscribe\":true}' > /tmp/tvtools.log 2>&1 &
	P=\$!
	i=0
	while :; do
		grep -q '\"state\":\"installed\"' /tmp/tvtools.log && break
		if grep -qiE 'fail|\"returnValue\":false' /tmp/tvtools.log || [ \$i -gt 60 ]; then
			kill \$P; tail -2 /tmp/tvtools.log >&2; echo 'install failed' >&2; exit 1
		fi
		i=\$((i + 1)); sleep 1
	done
	kill \$P
	rm -f /tmp/tvtools.ipk /tmp/tvtools.log"

echo "elevating $SVC_ID..."
# A copy of the service started before elevation keeps running without root
# for as long as it gets calls (an open TV Tools polls it). Stop it, so the
# next call starts the elevated one. (Its cmdline is the name padded with
# NULs, so a pattern ending in $ never matches.)
tv "$HB/elevate-service $SVC_ID && { pkill -f '^$SVC_ID' || true; }"

echo "done: $APP_ID"
