// Screensaver: our bouncing ball as the TV's screensaver instead of LG's clock,
// and turning the TV off after the screensaver has been up for a while.
//
// - screensaver-apply.sh swaps the screensaver: it bind-mounts saver/ over LG's
//   videoads web app and switches on LG's "video screensaver" setting, so LG
//   itself launches our page (see that script for why this way).
// - screensaver-watch.sh turns the TV off after `screensaver-off-hours` hours in
//   the screensaver.
// State:
//   screensaver            "on" = the bouncing ball (default: LG's own)
//   screensaver-off-hours  1-8, or "off" (the default)
//   screensaver-last-off   "<epoch s> <hours>" of the last automatic power-off

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const APPLY = path.join(__dirname, '..', 'screensaver-apply.sh');
const WATCHER = path.join(__dirname, '..', 'screensaver-watch.sh');
const PAGE = path.join(__dirname, '..', 'saver');
const COPY = '/tmp/tv-tools-saver';
const VIDEOADS = '/usr/palm/applications/com.webos.app.videoads';
const PIDFILE = '/tmp/tv-tools-saver-watch.pid';
const SINCE = '/tmp/tv-tools-saver-since';
const TVPOWER = 'luna://com.webos.service.tvpower';
const HOURS = [1, 2, 3, 4, 6, 8];

const saverOn = (ctx) => ctx.readState('screensaver') === 'on';

function offHours(ctx) {
  const v = ctx.readState('screensaver-off-hours');
  if (v === 'off') return 0;
  const n = parseInt(v, 10);
  return n > 0 ? n : 0;
}

function running() {
  try {
    const pid = parseInt(fs.readFileSync(PIDFILE, 'utf8'), 10);
    return pid > 0 && fs.existsSync('/proc/' + pid);
  } catch (e) { return false; }
}

// Both of videoads' files have our page mounted over them.
function mounted() {
  let m = '';
  try { m = fs.readFileSync('/proc/mounts', 'utf8'); } catch (e) { return false; }
  return m.includes(` ${VIDEOADS}/index.html `) && m.includes(` ${VIDEOADS}/app.js `);
}

// The mounted copy is the page this version ships (a deploy brings a new one).
function current() {
  try {
    return ['index.html', 'app.js'].every((f) =>
      fs.readFileSync(path.join(COPY, f)).equals(fs.readFileSync(path.join(PAGE, f))));
  } catch (e) { return false; }
}

function apply(on) {
  return new Promise((resolve, reject) => {
    execFile('/bin/sh', [APPLY, on ? 'on' : 'off'], { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve();
    });
  });
}

function startWatcher() {
  try {
    const child = spawn('/bin/sh', [WATCHER], { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* status shows it not running */ });
    child.unref();
  } catch (e) { /* ignore */ }
}

// The watcher exits by itself within 5 s once it isn't needed; this is for
// when it should stop now.
function stopWatcher() {
  try { process.kill(parseInt(fs.readFileSync(PIDFILE, 'utf8'), 10)); } catch (e) { /* not running */ }
  fs.rmSync(PIDFILE, { force: true });
}

const needed = (ctx) => saverOn(ctx) || offHours(ctx) > 0;

function restartWatcher(ctx) {
  if (needed(ctx)) startWatcher();
  else stopWatcher();
}

module.exports = {
  name: 'screensaver',

  init(ctx) {
    if (!ctx.isElevated()) return;
    // After a deploy the mount still holds the old page; put the new one up.
    if (saverOn(ctx) && !(mounted() && current())) apply(true).catch(() => { /* status shows it */ });
    if (needed(ctx) && !running()) startWatcher();
  },

  async status(ctx) {
    let since = null;
    try { since = parseInt(fs.readFileSync(SINCE, 'utf8'), 10) * 1000 || null; } catch (e) { /* not in the screensaver */ }
    let lastOff = null;
    const last = (ctx.readState('screensaver-last-off') || '').split(' ');
    if (last[0]) lastOff = { at: parseInt(last[0], 10) * 1000, hours: parseInt(last[1], 10) };
    let videoSaver = null;
    try {
      const r = await ctx.call('luna://com.webos.settingsservice/getSystemSettings', { category: 'lgchannels', keys: ['isVideoScreenSaverEnabled'] });
      videoSaver = r.settings.isVideoScreenSaverEnabled === true;
    } catch (e) { /* unknown */ }
    return {
      enabled: saverOn(ctx),
      // Ours shows only with both the mount and LG's setting in place.
      applied: mounted() && videoSaver === true,
      // The setting without our page would show LG's online video ads.
      adsRisk: videoSaver === true && !mounted(),
      offHours: offHours(ctx),
      hourChoices: HOURS,
      running: running(),
      needed: needed(ctx),
      since,
      lastOff,
    };
  },

  methods: {
    async setScreensaver(payload, ctx) {
      if (typeof payload.enabled !== 'boolean') throw new Error('"enabled" must be true or false');
      ctx.requireRoot();
      ctx.writeState('screensaver', payload.enabled ? 'on' : 'off');
      restartWatcher(ctx);
      await apply(payload.enabled);
      return { enabled: payload.enabled };
    },

    // hours: one of HOURS, or 0 for never.
    setScreensaverOffHours(payload, ctx) {
      const h = payload.hours;
      if (h !== 0 && !HOURS.includes(h)) throw new Error('"hours" must be 0 or one of ' + HOURS.join(', '));
      ctx.requireRoot();
      ctx.writeState('screensaver-off-hours', h === 0 ? 'off' : String(h));
      restartWatcher(ctx);
      return { offHours: h };
    },

    // "Show it now" on the card: start the screensaver exactly as LG's idle
    // timer does.
    async previewScreensaver(payload, ctx) {
      ctx.requireRoot();
      await ctx.call(`${TVPOWER}/power2/turnOnScreenSaver`, {});
      return { started: true };
    },
  },
};
