// Health: is the rooted setup still the way it should be?
//
// Read-only. `status` returns { checkedAt, bootedAt, checks }, and each check is
// { id, label, level, detail, time }:
//   level   ok | warn (works, but look at it) | bad (broken) | info (not in use, or just a fact)
//   detail  short text; "{time}" in it is replaced by the app with `time`
//           (ms), formatted in the TV's local time zone.
// The one write is the firmware baseline: the version seen on the first check
// is saved as state `health-firmware`, so a later change stands out. Delete
// that file to accept a new version.

const fs = require('fs');
const { execFile } = require('child_process');
const home = require('./home');
const launcher = require('./launcher');
const pointer = require('./pointer');
const keyhook = require('./keyhook');
const screensaver = require('./screensaver');

const HB = 'luna://org.webosbrew.hbchannel.service';
const UPDATE_SERVICE = 'luna://com.webos.service.update';
// Written by boot-hook.sh at the start of each boot. /tmp is RAM, so the file
// existing means the hook ran this boot.
const BOOT_MARK = '/tmp/tv-tools-boot';
// The hostnames Homebrew Channel's "Block system updates" points at 127.0.0.1.
const UPDATE_HOSTS = ['snu.lge.com', 'su.lge.com', 'su-ssl.lge.com', 'su-dev.lge.com'];
const MB = 1024 * 1024;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('no answer')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

function bootTimeMs() {
  const m = /^btime (\d+)/m.exec(read('/proc/stat') || '');
  return m ? Number(m[1]) * 1000 : null;
}

function formatMb(bytes) {
  const mb = bytes / MB;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
}

// Hostnames /etc/hosts sends to a loopback or null address.
function blockedHosts() {
  const blocked = new Set();
  for (const line of (read('/etc/hosts') || '').split('\n')) {
    const [addr, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    if (['127.0.0.1', '::1', '0.0.0.0'].includes(addr)) names.forEach((n) => blocked.add(n));
  }
  return blocked;
}

const checks = {
  async root(ctx, hb) {
    if (!ctx.isElevated()) return ['bad', 'TV Tools isn’t running as root. Reinstall it to fix.'];
    if (!hb) return ['warn', 'TV Tools has root. Homebrew Channel didn’t answer.'];
    if (!hb.root) return ['bad', 'Homebrew Channel reports no root'];
    return ['ok', 'TV Tools and Homebrew Channel'];
  },

  async updates(ctx, hb) {
    const blocked = blockedHosts();
    const open = UPDATE_HOSTS.filter((h) => !blocked.has(h));
    if (hb && !hb.blockUpdates) return ['bad', 'Homebrew Channel’s “Block system updates” is off'];
    if (open.length) return ['bad', 'Not blocked: ' + open.join(', ')];
    if (!hb) return ['warn', 'Hosts file blocks them. Homebrew Channel didn’t answer.'];
    return ['ok', 'Blocked by Homebrew Channel'];
  },

  async firmware(ctx) {
    let version = null;
    try {
      const sw = await withTimeout(ctx.call(`${UPDATE_SERVICE}/getCurrentSWInformation`, {}), 4000);
      if (sw.major_ver && sw.minor_ver) version = `${sw.major_ver}.${sw.minor_ver}`;
    } catch (e) { /* fall back to the build alone */ }
    const build = (/(\d+\.\d+\.\d+-\d+)/.exec(read('/etc/starfish-release') || '') || [])[1];
    const now = [version, build && `webOS ${build}`].filter(Boolean).join(' · ');
    if (!now) return ['warn', 'Couldn’t read the version'];

    const baseline = ctx.readState('health-firmware');
    if (!baseline) {
      try { ctx.writeState('health-firmware', now); } catch (e) { /* not root; try next time */ }
      return ['ok', now];
    }
    if (baseline !== now) return ['warn', `Changed from ${baseline} to ${now}`];
    return ['ok', now];
  },

  async boot(ctx, hb) {
    if (!fs.existsSync(ctx.bootHook)) return ['bad', 'Boot hook missing: settings won’t return after a restart'];
    if (hb && hb.failsafe) return ['bad', 'Homebrew Channel is in failsafe mode and skipped boot scripts'];
    const mark = parseInt(read(BOOT_MARK), 10);
    if (mark) return ['ok', 'Ran at {time}', mark * 1000];
    // The hook was replaced after this boot started (an update to TV Tools):
    // the old one may have run, but it left no mark.
    const boot = bootTimeMs();
    if (boot && fs.statSync(ctx.bootHook).mtimeMs > boot) return ['info', 'Checked from the next restart'];
    return ['bad', 'Didn’t run at the last restart'];
  },

  async homeRows(ctx) {
    const s = await home.status(ctx);
    const hidden = s.elements.filter((e) => e.hidden).length;
    if (s.bootDisabled) return ['warn', 'Undone at restart: LG Home didn’t start with them'];
    if (!s.supported) return ['warn', 'LG’s home app changed, so this is off'];
    if (!hidden) return ['info', 'None hidden'];
    const rows = hidden === 1 ? '1 row' : `${hidden} rows`;
    if (!s.applied) return ['bad', `${rows} set to hidden, but LG’s layout is back`];
    return ['ok', `${rows} hidden`];
  },

  async homeButton(ctx) {
    const s = await launcher.status(ctx);
    if (s.tripped) return ['warn', 'Switched itself off: ' + s.tripped.replace(/^[\d-]+ [\d:]+: /, '')];
    if (!s.redirect) return ['info', 'Opens LG Home'];
    if (!s.watcher) return ['bad', 'Set to our Home, but the watcher isn’t running'];
    return ['ok', 'Opens our Home'];
  },

  async pointer(ctx) {
    const s = await pointer.status(ctx);
    const value = s.value === 'off' ? 'Off' : s.value === 'on' ? 'On' : 'Unknown';
    if (!s.saved) return ['info', `${value} (not set here)`];
    if (s.value !== s.saved) return ['warn', `${value}, but TV Tools set it ${s.saved}. Fixed at the next restart.`];
    return ['ok', `${value}, as set`];
  },

  keyHook(ctx) {
    const s = keyhook.status(ctx);
    if (!s.enabled) return ['info', 'Home is LG’s'];
    // Enabled but not forwarding: the remote still works (the kernel drops the
    // grab when that process goes), but the button is LG's again.
    if (!s.running) return ['bad', 'Switched on, but nothing is watching the buttons'];
    return ['ok', 'Home opens ours'];
  },

  async screensaver(ctx) {
    const s = await screensaver.status(ctx);
    // LG's video-screensaver setting on without our page: LG's online video
    // ads would be the screensaver. The next boot (or the card's switch) fixes it.
    if (s.adsRisk) return ['bad', 'LG’s video screensaver is on without our page: it would show LG’s ads'];
    if (!s.needed) return ['info', 'LG’s, and the TV never turns itself off'];
    const off = s.offHours ? `, TV off after ${s.offHours} h` : '';
    if (s.enabled && !s.applied) return ['bad', 'Bouncing ball switched on, but LG’s screensaver is showing'];
    if (!s.running) return ['bad', 'Switched on, but the watcher isn’t running'];
    return ['ok', (s.enabled ? 'Bouncing ball' : 'LG’s') + off];
  },

  async storage() {
    // Node 16 has no fs.statfs; busybox df -P prints one line per filesystem.
    // /var holds settings (LG's and ours); Homebrew apps live on a bigger partition.
    const out = await run('df', ['-Pk', '/var', '/media/developer']);
    const free = (out || '').trim().split('\n').slice(1).map((line) => Number(line.split(/\s+/)[3]) * 1024);
    if (free.length !== 2 || !free.every(Number.isFinite)) return ['warn', 'Couldn’t read'];
    const [settings, apps] = free;
    const level = settings < 50 * MB || apps < 200 * MB ? 'warn' : 'info';
    return [level, `${formatMb(settings)} settings, ${formatMb(apps)} apps`];
  },

  async memory() {
    const info = read('/proc/meminfo') || '';
    const kb = (key) => Number((new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(info) || [])[1]) * 1024;
    const total = kb('MemTotal');
    const free = kb('MemAvailable');
    if (!total || !free) return ['warn', 'Couldn’t read'];
    return [free < 100 * MB ? 'warn' : 'info', `${formatMb(free)} of ${formatMb(total)} free`];
  },
};

const LABELS = {
  root: 'Root',
  updates: 'System updates',
  firmware: 'Firmware',
  boot: 'Boot scripts',
  homeRows: 'Home screen rows',
  homeButton: 'Home button',
  pointer: 'Remote pointer',
  keyHook: 'Instant Home',
  screensaver: 'Screensaver',
  storage: 'Storage',
  memory: 'Memory',
};

module.exports = {
  name: 'health',

  async status(ctx) {
    let hb = null;
    try { hb = await withTimeout(ctx.call(`${HB}/getConfiguration`, {}), 4000); } catch (e) { /* reported by the checks */ }
    const results = await Promise.all(Object.entries(checks).map(async ([id, check]) => {
      let level;
      let detail;
      let time;
      try {
        [level, detail, time] = await check(ctx, hb);
      } catch (e) {
        [level, detail] = ['warn', 'Couldn’t check: ' + e.message];
      }
      return { id, label: LABELS[id], level, detail, time: time || null };
    }));
    return { checkedAt: Date.now(), bootedAt: bootTimeMs(), checks: results };
  },
};
