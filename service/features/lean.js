// Leaner LG: switch off LG features you don't use.
//
// Switches: LG's own privacy and promotion settings. They are ordinary settings,
// so they persist, and switching one back on
// here restores LG's behaviour. Ones switched off are saved as state `lean-off`
// and re-applied at boot (boot.d/lean.sh), in case LG flips one back.
//
// Services: LG background daemons, kept from running until the next restart by
// bind-mounting a stand-in (STUB, in RAM) over the program. LG's hub starts most
// of them on demand, so just killing one doesn't stick; the stand-in logs the
// attempt and exits, and callers get an immediate "not running". The two that are
// also systemd units are stopped too. (`mask --runtime` has no effect on them:
// their units are in /etc/systemd/system, which outranks /run. At boot systemd
// retried uploadd 5 times, ran the stand-in each time and gave up as "failed",
// which is the right end state.) Undo: unmount (the toggle) or restart the TV.
//
// LG turns some switches back on by itself: at boot (channelplus, dbgLogUpload)
// and at every power-on (com.webos.pmlogd set dbgLogUpload back to true at
// 07:43 on 2026-09-25, per SYSTEM_SETTING_CHANGED in /var/log/dbg-log). So
// lean-watch.sh subscribes to the option and general settings and calls
// applyLean {reason: "watch"} on every change; each switch it puts back is
// logged in LEAN_LOG and shown on the card. The boot re-check still matters, and
// applyLean writes APPLIED when it's done. Ones switched off are saved as `lean-services-off` and
// re-applied at boot, but only on the firmware they were tested on (TESTED_BUILD);
// boot.d/lean.sh watches for trouble and undoes them all if it sees any.
// Tested 2026-09-24, each alone and all together: Home, Netflix, YouTube, the
// LG Home redirect, AirPlay, Chromecast and LG's local control ports (3000/3001)
// all fine. NOT on the list:
// sdx (the LG app store says "Service is temporarily unavailable" without it),
// and anything Alexa or ThinQ (Alexa turns the TV off through those).

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const SETTINGS = 'luna://com.webos.settingsservice';
const TESTED_BUILD = '10.3.1-3007';
const LEAN_DIR = '/tmp/tv-tools-lean';
const STUB = LEAN_DIR + '/stub';
const LAUNCH_LOG = LEAN_DIR + '/launches.log';
const TRIPPED = '/var/lib/tv-tools/lean-tripped'; // written by boot.d/lean.sh when it undid the services
const APPLIED = LEAN_DIR + '/applied'; // this boot's re-check is done
const LEAN_LOG = '/var/lib/tv-tools/lean-log'; // one JSON line per switch put back: {at, reason, fixed}
const WATCHER = path.join(__dirname, '..', 'lean-watch.sh');

const SERVICES = [
  { id: 'acr2', label: 'Content recognition', desc: 'acr2' },
  { id: 'admanager', label: 'Ad manager', desc: 'admanager' },
  { id: 'adoverlay-service', label: 'Ad overlays', desc: 'adoverlay-service' },
  { id: 'livepick-plus', label: 'LG promotions', desc: 'livepick-plus' },
  { id: 'contentminer', label: 'Content analysis', desc: 'contentminer', unit: 'contentminer.service' },
  { id: 'color-info-miner', label: 'Picture analysis', desc: 'color-info-miner' },
  { id: 'uploadd', label: 'Log uploader', desc: 'uploadd', unit: 'uploadd.service' },
  { id: 'sportsalarm', label: 'Sports alerts', desc: 'sportsalarm' },
];

const STUB_SCRIPT = `#!/bin/sh
# TV Tools, Leaner LG: stands in for an LG service switched off in TV Tools.
# Logs the launch attempt (boot.d/lean.sh watches the rate) and exits.
L=${LAUNCH_LOG}
[ -f "$L" ] && [ "$(wc -c < "$L")" -gt 200000 ] && : > "$L"
echo "$(date +%s) $0" >> "$L"
exit 1
`;

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || stderr || '').trim() }));
  });
}

const bin = (svc) => '/usr/sbin/' + svc.id;

function overlaid(svc) {
  try { return fs.readFileSync('/proc/mounts', 'utf8').includes(' ' + bin(svc) + ' '); } catch (e) { return false; }
}

function killRunning(path) {
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch (e) { continue; }
    if (cmd.startsWith(path + '\0') || cmd === path) {
      try { process.kill(Number(pid)); } catch (e) { /* already gone */ }
    }
  }
}

function tested() {
  try { return fs.readFileSync('/etc/starfish-release', 'utf8').includes(TESTED_BUILD); } catch (e) { return false; }
}

async function serviceOff(svc) {
  fs.mkdirSync(LEAN_DIR, { recursive: true });
  if (!fs.existsSync(STUB)) fs.writeFileSync(STUB, STUB_SCRIPT, { mode: 0o755 });
  if (svc.unit) {
    await run('systemctl', ['stop', svc.unit]);
    await run('systemctl', ['mask', '--runtime', svc.unit]);
  }
  if (!overlaid(svc)) {
    const r = await run('mount', ['--bind', STUB, bin(svc)]);
    if (!r.ok) throw new Error(`Couldn’t switch off ${svc.id}: ${r.out}`);
  }
  killRunning(bin(svc));
}

async function serviceOn(svc) {
  for (let i = 0; i < 5 && overlaid(svc); i++) await run('umount', [bin(svc)]);
  if (svc.unit) {
    await run('systemctl', ['unmask', '--runtime', svc.unit]);
    await run('systemctl', ['start', svc.unit]);
  }
  if (overlaid(svc)) throw new Error(`Couldn’t switch ${svc.id} back on`);
}

// Start lean-watch.sh (it exits at once if it's already running or nothing is off).
function startWatcher() {
  try {
    const child = spawn('/bin/sh', [WATCHER], { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* shown as no fixes being logged */ });
    child.unref();
  } catch (e) { /* ignore */ }
}

// applyLean calls run one at a time: lean-watch.sh's two subscriptions can fire
// together, and two overlapping calls would both see a switch on and both log it.
let applying = Promise.resolve();

function logFix(reason, fixed) {
  let lines = [];
  try { lines = fs.readFileSync(LEAN_LOG, 'utf8').split('\n').filter(Boolean); } catch (e) { /* first one */ }
  lines.push(JSON.stringify({ at: Date.now(), reason, fixed }));
  fs.writeFileSync(LEAN_LOG, lines.slice(-50).join('\n') + '\n');
}

function lastFix() {
  try {
    const lines = fs.readFileSync(LEAN_LOG, 'utf8').split('\n').filter(Boolean);
    const f = JSON.parse(lines[lines.length - 1]);
    const labels = f.fixed.map((id) => (SWITCHES.find((x) => x.id === id) || { label: id }).label);
    return { at: f.at, reason: f.reason, labels };
  } catch (e) { return null; }
}

function readServicesOff(ctx) {
  const known = new Set(SERVICES.map((x) => x.id));
  return (ctx.readState('lean-services-off') || '').split(/\s+/).filter((id) => known.has(id));
}

const SWITCHES = [
  { id: 'livePlus', label: 'Live Plus', category: 'option', key: 'livePlus', on: 'on', off: 'off',
    desc: 'Recognizes what’s on screen and reports it to LG' },
  { id: 'adCookie', label: 'Ad tracking ID', category: 'general', key: 'adCookie', on: 'on', off: 'off',
    desc: 'Personalized ads' },
  { id: 'dbgLogUpload', label: 'Debug log upload', category: 'option', key: 'dbgLogUpload', on: true, off: false,
    desc: 'Sends the TV’s logs to LG' },
  { id: 'livePromotion', label: 'Live TV promotions', category: 'option', key: 'livePromotion', on: 'on', off: 'off',
    desc: 'Promotions over live TV' },
  { id: 'channelplus', label: 'LG Channels', category: 'option', key: 'channelplus', on: 'on', off: 'off',
    desc: 'LG’s free streaming channels' },
  { id: 'sportsAlarm', label: 'Sports alerts', category: 'general', key: 'sportsAlarm', on: 'on', off: 'off',
    desc: 'Score pop-ups' },
];

function readOff(ctx) {
  const known = new Set(SWITCHES.map((s) => s.id));
  return (ctx.readState('lean-off') || '').split(/\s+/).filter((id) => known.has(id));
}

async function current(ctx) {
  const byCategory = {};
  for (const s of SWITCHES) (byCategory[s.category] = byCategory[s.category] || []).push(s.key);
  const values = {};
  for (const [category, keys] of Object.entries(byCategory)) {
    const res = await ctx.call(`${SETTINGS}/getSystemSettings`, { category, keys });
    for (const k of keys) values[`${category}.${k}`] = (res.settings || {})[k];
  }
  return values;
}

async function set(ctx, s, off) {
  await ctx.rememberOriginal(s.category, s.key);
  await ctx.call(`${SETTINGS}/setSystemSettings`, { category: s.category, settings: { [s.key]: off ? s.off : s.on } });
}

module.exports = {
  name: 'lean',

  init(ctx) {
    if (readOff(ctx).length) startWatcher();
  },

  async status(ctx) {
    const values = await current(ctx);
    let tripped = null;
    try { tripped = fs.readFileSync(TRIPPED, 'utf8').trim(); } catch (e) { /* never */ }
    const saved = new Set(readServicesOff(ctx));
    return {
      services: SERVICES.map((svc) => ({ id: svc.id, label: svc.label, desc: svc.desc, off: overlaid(svc), saved: saved.has(svc.id) })),
      tested: tested(),
      tripped,
      lastFix: lastFix(),
      switches: SWITCHES.map((s) => {
        const value = values[`${s.category}.${s.key}`];
        return { id: s.id, label: s.label, desc: s.desc, off: value === s.off, known: value === s.off || value === s.on };
      }),
    };
  },

  methods: {
    async setLeanSwitch(payload, ctx) {
      const s = SWITCHES.find((x) => x.id === payload.id);
      if (!s) throw new Error('Unknown switch: ' + payload.id);
      if (typeof payload.off !== 'boolean') throw new Error('"off" must be true or false');
      ctx.requireRoot();
      await set(ctx, s, payload.off);
      const off = new Set(readOff(ctx));
      if (payload.off) off.add(s.id);
      else off.delete(s.id);
      ctx.writeState('lean-off', Array.from(off).join(' '));
      if (payload.off) startWatcher();
      const values = await current(ctx);
      return { off: values[`${s.category}.${s.key}`] === s.off };
    },

    async setLeanService(payload, ctx) {
      const svc = SERVICES.find((x) => x.id === payload.id);
      if (!svc) throw new Error('Unknown service: ' + payload.id);
      if (typeof payload.off !== 'boolean') throw new Error('"off" must be true or false');
      ctx.requireRoot();
      if (payload.off && !tested()) throw new Error('This firmware isn’t the one these were tested on, so services stay on.');
      if (payload.off) await serviceOff(svc);
      else await serviceOn(svc);
      const off = new Set(readServicesOff(ctx));
      if (payload.off) off.add(svc.id);
      else off.delete(svc.id);
      ctx.writeState('lean-services-off', Array.from(off).join(' '));
      if (payload.off) fs.rmSync(TRIPPED, { force: true });
      return { off: overlaid(svc) };
    },

    // boot.d/lean.sh's watchdog: put every service back on and forget the
    // choices; TRIPPED says why until one is switched off again.
    async undoLeanServices(payload, ctx) {
      ctx.requireRoot();
      for (const svc of SERVICES) await serviceOn(svc);
      ctx.writeState('lean-services-off', '');
      fs.writeFileSync(TRIPPED, `${new Date().toISOString().slice(0, 16).replace('T', ' ')}: ${String(payload.reason || 'undone').slice(0, 120)}\n`);
      return {};
    },

    // Boot: overlay the saved services (first, before LG starts them on demand),
    // then switch off again any setting LG turned back on. Returns what it did.
    // reason "watch" (lean-watch.sh, on a settings change): switches only.
    applyLean(payload, ctx) {
      const run = applying.then(() => applyLeanNow(payload, ctx));
      applying = run.catch(() => {});
      return run;
    },
  },
};

// The body of applyLean (see there).
async function applyLeanNow(payload, ctx) {
  ctx.requireRoot();
  const reason = payload.reason === 'watch' ? 'watch' : 'boot';
  const services = [];
  if (tested() && reason === 'boot') {
    for (const svc of SERVICES.filter((x) => readServicesOff(ctx).includes(x.id))) {
      await serviceOff(svc);
      services.push(svc.id);
    }
  }
  const values = await current(ctx);
  const fixed = [];
  for (const s of SWITCHES.filter((x) => readOff(ctx).includes(x.id))) {
    if (values[`${s.category}.${s.key}`] !== s.off) {
      await set(ctx, s, true);
      fixed.push(s.id);
    }
  }
  if (fixed.length) logFix(reason, fixed);
  if (reason === 'boot') {
    fs.mkdirSync(LEAN_DIR, { recursive: true });
    fs.writeFileSync(APPLIED, String(Date.now()));
  }
  return { fixed, services };
}
