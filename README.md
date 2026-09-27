# TV Tools

Small tweaks for a rooted LG webOS TV, in one Homebrew Channel app you drive
with the arrows and OK. It includes an optional replacement home screen.

**Tested on:** LG OLED65C5AUA, webOS 10.3.1 (firmware 33.31.69, build
10.3.1-3007). Several tools check LG's files against the exact versions they
were tested on and switch themselves off on anything else. They show as
unavailable instead of guessing.

**Needs:** a rooted TV with [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel).
TV Tools' service runs as root (Homebrew Channel elevates it).

## What it does

Every tool starts off. Nothing changes on the TV until you switch it on from its card.

- **Health.** A read-only checklist at the top: root, the system-update block
  (Homebrew Channel's setting and the `/etc/hosts` entries), firmware (warns if it
  ever differs from the version first seen), whether the boot hook ran this boot,
  and whether each tool below is in the state it was set to. Also shows free
  storage, memory and the last restart.
- **Magic Remote pointer on/off.** Flips LG's hidden `general.remotePointer`
  setting. With it `off`, the remote never shows a cursor (shaking included) and
  OK is sent as Enter. Re-applied at boot, in case LG flips it back.
- **Home screen: hide rows.** Hides the Edit button row (`qcardList`) and the
  Recent Input & Device Functions row (`recommendedShelf`) on LG's home screen.
  LG's layout files are never edited. Filtered copies in `/var/lib/tv-tools/home/`
  are bind-mounted over them, and LG Home is restarted. At boot they are
  re-mounted only if LG's file still matches the tested SHA-256. A watchdog
  restores the stock layout if LG Home keeps crashing.
- **Home screen.** Picks which home screen the Home button opens: LG's, or ours
  (see "Home screen" below). "Open ours now" shows it without changing anything.
- **Instant Home.** With our home screen chosen, LG's still flashes up for a
  moment before ours. This takes the remote's Home button over so it goes
  straight to ours. See "Remote key hook" below.
- **Bouncing-ball screensaver.** A white ball that falls and bounces under
  gravity with a fading trail, in place of LG's clock. See "Bouncing-ball
  screensaver" below.
- **Turn the TV off after N hours of screensaver** (1, 2, 3, 4, 6 or 8).
  `service/screensaver-watch.sh` checks the power state every 5 s and makes the
  same call as LG's own Auto Power Off (`tvpower/power2/powerOff`, reason
  `autoOff`). It only does this while the state still reads "Screen Saver", so a
  film being watched is never cut off. LG's own Auto Power Off counts time since
  the last button press, so it can switch off mid-film.
- **Leaner LG.** Switches off LG extras through LG's own settings:
  - Live Plus (`option.livePlus`, content recognition)
  - the ad-tracking ID (`general.adCookie`)
  - debug log upload (`option.dbgLogUpload`)
  - live-TV promotions (`option.livePromotion`)
  - LG Channels (`option.channelplus`)
  - sports alerts (`general.sportsAlarm`)

  LG turns some of these back on by itself, at boot and at power-on.
  `service/lean-watch.sh` watches those settings and switches them off again
  within about a second, and the card shows the last fix.

  A second card switches off eight LG background services, each tested without
  it on webOS 10.3.1:
  - `acr2`, `admanager`, `adoverlay-service`, `livepick-plus`
  - `contentminer`, `color-info-miner`, `uploadd`, `sportsalarm`

  Each is kept from running by bind-mounting a stand-in script over its program
  until the next restart. `boot.d/lean.sh` re-applies them about a minute after
  boot, but only on the tested firmware. For 10 minutes afterwards, a watchdog
  puts them all back if LG keeps relaunching one. `sdx` is deliberately not on
  the list: the LG app store needs it.
- **Reboot TV.** Runs `/sbin/reboot` as root, after a confirm dialog with Cancel
  focused.

## Safety

- **LG's system files are never written.** Every change is either an LG setting
  (switchable back from the same card) or a `mount --bind` from our own copy,
  which a restart removes.
- **Boot:** the service symlinks `service/boot-hook.sh` to
  `/var/lib/webosbrew/init.d/tv-tools`. It is a symlink, not a copy, so
  uninstalling TV Tools breaks it and nothing of ours runs at boot again. The
  hook runs each `service/boot.d/*.sh`. Each one does nothing unless its card
  was used, and checks its target before acting. What ran is written to
  `/var/log/tv-tools.log`, replaced every boot. On webOS `/var/log` is in RAM,
  so the log never touches flash storage.
- **Uninstalling puts the TV back, with no restart.** webOS runs nothing of an
  app's when it's removed, so `service/uninstall-watch.sh` checks every 10 s that
  TV Tools is still installed. Once it has been gone for 30 s (an update removes
  it for a moment too), the watcher does the following:
  - stops the remote key hook and every watcher;
  - removes every bind mount, bringing back LG's screensaver, home screen rows
    (LG Home is restarted to show them) and background services;
  - sets each LG setting TV Tools changed (the pointer, the Leaner LG switches)
    back to the value it had before TV Tools first changed it. Settings TV Tools
    never touched are left alone;
  - deletes `/var/lib/tv-tools/`, the boot hook link and the log.

  What it did is in `/tmp/tv-tools-uninstall.log` until the next restart.

## Home screen

The home screen is TV Tools' second screen (`app/home.html`, `app/home.js`).
It's a replacement home screen with:
- a clock;
- Inputs, Settings and LG Home buttons;
- a big top row of 5 apps, and an 8-column grid of the rest.

**One app, two screens.** `app/view.js` loads first on both pages:
- launched with `{"view":"home"}`, TV Tools shows the home screen;
- launched any other way (its tile, Homebrew Channel), it shows the cards;
- a relaunch that asks for the other screen switches page;
- the cards opened from the home screen's TV Tools tile go back to it on Back.

`service/features/launcher.js` does the work behind it:
- lists apps;
- serves icons as data URLs, because web apps can't read other apps' files;
- launches apps;
- stores the layout.

On a tile, **hold OK** (0.7 s) for its menu: Move, Rename (uses LG's on-screen
keyboard), Use LG's name, Hide/Unhide. When moving a tile, the arrows move it,
OK drops it and Back cancels. OK acts on release, so a short press still opens
the app. Hidden apps show behind a "Hidden apps" tile at the end of the grid.

**Redirect:** `service/boot.d/launcher.sh` watches the foreground app. Whenever
LG Home comes to the front, it launches TV Tools with `{"view":"home"}`, about
0.25 s later. LG's
home and the Home key are untouched. The "LG Home" button pauses the redirect
until another app opens.

Loop guard: the watcher switches the redirect off and records why in
`/var/lib/tv-tools/redirect-tripped` if either happens:
- 3 redirects in a row without TV Tools reaching the front;
- more than 10 redirects in a minute.

## Remote key hook

`service/key-hook.py` claims the Home button (evdev code 773) while our home
screen is chosen, and launches it directly, so LG Home never starts (20 ms,
measured).

**How it works:** it uses plain evdev. It takes an exclusive grab (`EVIOCGRAB`)
of the device the real remote sends on (`LGE M-RCU - Builtin [0]`). It forwards
everything else verbatim to the idle `Builtin [1]`, which the compositor also
reads.

**Nothing of LG's is patched, injected into or restarted.** The kernel drops the
grab when that process exits. A crash, a kill, the card's switch or a reboot all
put the remote straight back to stock. The dangerous failure is a hang instead,
so the loop does nothing slow (the launch goes to a background `luna-send`), and
a SIGALRM makes it exit rather than wedge. If the remote's devices aren't found
by those names, it doesn't start.

## Bouncing-ball screensaver

The page is `service/saver/` (`index.html`, `app.js`, a 2D canvas).
`service/screensaver-apply.sh on|off` puts it in place or takes it away.

**How it becomes LG's screensaver without touching LG's files.** `tvpowerd`
launches one of two LG apps as the screensaver:
- normally `com.webos.app.screensaver` (the compiled Flutter clock);
- with the LG setting `lgchannels.isVideoScreenSaverEnabled` on, the web app
  `com.webos.app.videoads` instead, whose two files only redirect to LG's online
  video ads.

"on" does three things:
1. Checks that LG's `index.html` and `app.js` match the tested SHA-256.
2. Bind-mounts our page over them, from a copy in `/tmp/tv-tools-saver`.
3. Sets that key.

LG then launches, focuses, wakes and closes our page exactly as its own. The
state still reads "Screen Saver", and LG's idle timer and its never-over-video
rule are unchanged. Any key press wakes it.

**The setting must never be on without our page,** or the screensaver would be
LG's video ads. So:
- "on" mounts first and sets the key second;
- "off" and the boot script clear the key first;
- the watcher clears it if it ever finds it on without the mount;
- Health flags that state as bad.

LG's `dmost` (the LG Channels service) owns that key and recomputes it now and
then, so the watcher puts it back within 5 s.

**Screen protection**, like LG's own screensaver:
- The ball never stops, and each floor bounce changes its height and speed, so
  it never retraces a path.
- Every 45-75 s the screen fades to black for 4 s, and a new scene starts with a
  new size, drop point and direction.
- It dims to 60% over the first hour.

## Layout

- `app/`: web app. `index.html` and `app.js` are the cards' shell (Luna calls,
  D-pad focus, confirm dialog), and each card is one file in `app/features/`.
  `home.html` and `home.js` are the home screen. `view.js` picks between them.
- `service/`: JS service, elevated to root by Homebrew Channel. `service.js`
  loads each module in `service/features/` and merges their `status`.
- `service/boot-hook.sh`: symlinked as `/var/lib/webosbrew/init.d/tv-tools`.
  Once per boot it runs every `service/boot.d/*.sh` from the installed app.
- State lives in `/var/lib/tv-tools/<key>`, one small file per key.

## Adding a tool

1. `service/features/<name>.js`: export `name`, and optionally `status(ctx)`,
   `methods: { lunaMethod(payload, ctx) }` and `init(ctx)`.
   - Call `ctx.requireRoot()` before anything that changes the TV.
   - Add `<name>` to `FEATURES` in `service/service.js`.
   - Luna method names share one namespace, so give them specific names
     (`setPointer`, not `set`).
2. `app/features/<name>.js`: `TVTools.register({ id, mount(card, api), update(status) })`,
   and add a `<script>` tag for it in `app/index.html`. Card order follows the
   script order.
3. If the tool can silently stop working (a mount, a watcher, a setting the TV
   can flip back), add a check for it to `service/features/health.js`.
4. Boot-time work, if any, goes in `service/boot.d/<name>.sh`.
   - Exit at once unless the tool was switched on.
   - Check the target exists before acting on it.
   - Background any waiting, since `run-parts` blocks boot on each hook.
5. Bump `version` in `app/appinfo.json`.

## Build and install

```bash
tools/build.py            # dist/io.github.theo78825.tvtools_<version>_all.ipk
```

`tools/build.py` builds the IPK in pure Python, with no ares CLI.

To install over SSH instead of from Homebrew Channel:

```bash
tools/deploy.sh root@TV_IP
```

That script installs through `appInstallService`, then runs Homebrew Channel's
`elevate-service`. Export `SSHPASS` to use a password through `sshpass`.

`tools/manifest.py dist/<ipk>` writes the Homebrew Channel manifest for a
release next to the IPK.

## Testing without the remote

The TV serves Chrome DevTools for dev-mode apps on port 9998. Open the app,
then take the page from `http://TV_IP:9998/json/list`. Send it
`Input.dispatchKeyEvent` with `windowsVirtualKeyCode` (13 OK, 37–40 arrows,
461 Back), which exercises the real key handling. Call the service directly:

```bash
luna-send -n 1 luna://io.github.theo78825.tvtools.service/status '{}' </dev/null
```

`luna-send` exits silently when stdin is a pipe or socket (for example a
non-interactive SSH session), so always give it `</dev/null` or a TTY.

## Licence

MIT, see [LICENSE](LICENSE).
