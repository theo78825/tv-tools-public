#!/usr/bin/env python3
# Remote key hook (TV Tools, features/keyhook.js). Sends the remote's Home button
# straight to our home screen, so LG's never starts and never flashes up first.
#
# How, and why this way: the physical Magic Remote
# delivers every key on "Builtin [0]". We take an exclusive grab of it, so LG
# stops seeing it, and forward each event verbatim to the idle "Builtin [1]",
# which has the same capabilities and which surface-manager also reads. LG treats
# forwarded keys as real. Keys we claim are simply never forwarded. Nothing of
# LG's is patched, injected into or restarted.
#
# THE FAILURE MODE IS A HANG, NOT A CRASH. The kernel drops the grab when our fd
# closes, so a crash, a kill, or this script exiting puts the remote back to
# stock immediately. A wedged forwarder would instead hold the remote hostage. So:
#   - nothing slow (luna-send, network, disk) happens in the loop; claimed keys
#     are handed to a background child;
#   - SIGALRM fires if one pass takes too long, and we die on purpose.
# Started by the service and boot.d/keyhook.sh; runs while state `key-hook` is on.

import fcntl
import os
import re
import select
import signal
import struct
import subprocess
import sys
import time

EVIOCGRAB = 0x40044590
FMT = 'llHHi'  # struct input_event on this 32-bit userland
SZ = struct.calcsize(FMT)
DEVICES = '/proc/bus/input/devices'
SRC_NAME = 'LGE M-RCU - Builtin [0]'  # what the real remote sends on
DST_NAME = 'LGE M-RCU - Builtin [1]'  # idle sibling, same caps, LG reads it
STATE = '/var/lib/tv-tools/key-hook'
PIDFILE = '/tmp/tv-tools-keyhook.pid'
APP = 'io.github.theo78825.tvtools'
REDIRECT = '/var/lib/tv-tools/redirect'  # the Home screen card's "Home button opens ours"
WEDGED = 5  # seconds for one pass; longer means something is wrong, so exit

# We call applicationManager straight, not our own service: the service is a
# dynamic one that exits a few seconds after its last call, so routing through it
# meant paying for a Node cold start on the press (~0.6 s of the measured 2.7 s).
#
# Home (773) goes straight to our Home, so LG Home never starts and there's no
# flash of it first. Only claimed while the Home screen card's redirect is on, so
# that one switch still decides which Home the button opens; with it off the key
# is forwarded and LG handles it as usual. boot.d/launcher.sh's watcher stays as
# the backstop for LG Home opened some other way (a tile, an app).
HOME_KEY = 773
HOME_CALL = ('luna://com.webos.applicationManager/launch', '{"id":"%s","params":{"view":"home"}}' % APP)

# The claimed key never reaches the screensaver, which is what turns a key press
# into a wake, so while screensaver-watch.sh says the screensaver is up
# (SAVER_UP), it also wakes the TV. tvpowerd then closes the
# screensaver itself.
SAVER_UP = '/tmp/tv-tools-saver-up'
SAVER_WAKE = [('luna://com.webos.service.tvpower/power/turnOnScreen', '{}')]


def node(name):
    """The /dev/input/eventN for a device name, which is stabler than an index."""
    try:
        blocks = open(DEVICES).read().split('\n\n')
    except OSError:
        return None
    for block in blocks:
        if 'N: Name="%s"' % name in block:
            m = re.search(r'\b(event\d+)\b', block)
            if m:
                return '/dev/input/' + m.group(1)
    return None


def on(path):
    try:
        return open(path).read().strip() == 'on'
    except OSError:
        return False


def enabled():
    return on(STATE)


def main():
    if not enabled():
        return 0
    src_path, dst_path = node(SRC_NAME), node(DST_NAME)
    if not src_path or not dst_path:
        sys.stderr.write('remote input devices not found\n')
        return 1

    # Children (luna-send) are reaped by the kernel, never waited for here.
    signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    signal.signal(signal.SIGALRM, lambda *a: sys.exit('forwarding stalled'))

    src = os.open(src_path, os.O_RDONLY)
    dst = os.open(dst_path, os.O_WRONLY)
    try:
        fcntl.ioctl(src, EVIOCGRAB, 1)
        open(PIDFILE, 'w').write(str(os.getpid()))
        checked = 0.0
        redirect = on(REDIRECT)
        while True:
            signal.alarm(WEDGED)
            if not select.select([src], [], [], 0.5)[0]:
                # Idle: this is the only place slow-ish work is safe.
                if time.time() - checked > 2:
                    checked = time.time()
                    if not enabled():
                        break
                    redirect = on(REDIRECT)
                continue
            data = os.read(src, SZ * 64)
            if not data:
                break
            out = bytearray()
            claimed = []
            for i in range(0, len(data) - SZ + 1, SZ):
                _, _, typ, code, val = struct.unpack(FMT, data[i:i + SZ])
                if typ == 1 and code == HOME_KEY and redirect:
                    if val == 1:
                        claimed.append(HOME_CALL)  # act on the press; drop release and repeat
                    continue
                out += data[i:i + SZ]
            if out:
                os.write(dst, bytes(out))
            if claimed and os.path.exists(SAVER_UP):
                claimed = SAVER_WAKE + claimed
            for uri, payload in claimed:
                # Fire and forget: the loop must never wait on luna-send.
                subprocess.Popen(
                    ['luna-send', '-n', '1', uri, payload],
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, start_new_session=True)
    finally:
        signal.alarm(0)
        try:
            fcntl.ioctl(src, EVIOCGRAB, 0)
        except OSError:
            pass
        os.close(src)
        os.close(dst)
        # Only our own: a second copy that failed to grab (the first holds it)
        # must not delete the running one's pidfile, or status says "not running".
        try:
            if open(PIDFILE).read().strip() == str(os.getpid()):
                os.unlink(PIDFILE)
        except OSError:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
