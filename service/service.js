// TV Tools service. Runs as root once elevated by Homebrew Channel.
//
// Each module in features/ is one tool. A feature exports:
//   name     key for its section of the `status` response
//   status   async (ctx) => object          (optional)
//   methods  { lunaMethod: async (payload, ctx) => response }  (optional)
//   init     (ctx) => void, run once at startup when elevated   (optional)
// Boot-time work goes in boot.d/<feature>.sh, which the init.d hook runs.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Service = require('webos-service');
const pkg = require('./package.json');

const FEATURES = ['health', 'network', 'pointer', 'home', 'launcher', 'lean', 'keyhook', 'screensaver', 'power'].map((name) => require('./features/' + name));

const service = new Service(pkg.name);

const STATE_DIR = '/var/lib/tv-tools';
const HOOK_SRC = path.join(__dirname, 'boot-hook.sh');
const HOOK_DST = '/var/lib/webosbrew/init.d/tv-tools';
const UNINSTALL_WATCH = path.join(__dirname, 'uninstall-watch.sh');

function isElevated() {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

const ctx = {
  call(uri, params) {
    return new Promise((resolve, reject) => {
      service.call(uri, params, (message) => {
        const p = message.payload || {};
        if (p.returnValue === false) reject(new Error(p.errorText || `${uri} failed`));
        else resolve(p);
      });
    });
  },
  isElevated,
  bootHook: HOOK_DST,
  requireRoot() {
    if (!isElevated()) {
      throw new Error('Service is not elevated. Run Homebrew Channel\'s elevate-service for ' + pkg.name + '.');
    }
  },
  // Small persistent values, one file per key under STATE_DIR.
  readState(key) {
    try { return fs.readFileSync(path.join(STATE_DIR, key), 'utf8').trim(); } catch (e) { return null; }
  },
  writeState(key, value) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, key), value + '\n');
  },
  // Call before TV Tools changes an LG setting: keeps the value it had before
  // the first change (as JSON, state `orig-<category>.<key>`), which
  // uninstall-watch.sh puts back if TV Tools is uninstalled.
  async rememberOriginal(category, key) {
    const name = `orig-${category}.${key}`;
    if (this.readState(name) !== null) return;
    const res = await this.call('luna://com.webos.settingsservice/getSystemSettings', { category, keys: [key] });
    const value = (res.settings || {})[key];
    if (value !== undefined) this.writeState(name, JSON.stringify(value));
  },
};

// A symlink into the installed app, never a copy: when the app is uninstalled
// the link breaks and Homebrew Channel's run-parts skips it, so nothing of ours
// keeps running at boot.
function installBootHook() {
  let have = null;
  try { have = fs.readlinkSync(HOOK_DST); } catch (e) { /* missing, or not a link */ }
  if (have === HOOK_SRC) return;
  fs.mkdirSync(path.dirname(HOOK_DST), { recursive: true });
  fs.rmSync(HOOK_DST, { force: true });
  fs.symlinkSync(HOOK_SRC, HOOK_DST);
}

function handler(fn) {
  return (message) => {
    Promise.resolve()
      .then(() => fn(message.payload || {}))
      .then((result) => message.respond(Object.assign({ returnValue: true }, result)))
      .catch((err) => message.respond({ returnValue: false, errorText: err.message }));
  };
}

service.register('status', handler(async () => {
  const out = { elevated: isElevated(), bootHook: fs.existsSync(HOOK_DST) };
  for (const f of FEATURES) {
    if (f.status) out[f.name] = await f.status(ctx);
  }
  return out;
}));

for (const f of FEATURES) {
  for (const [method, fn] of Object.entries(f.methods || {})) {
    service.register(method, handler((payload) => fn(payload, ctx)));
  }
}

// Puts the TV back if TV Tools is uninstalled; it exits at once if already running.
function startUninstallWatch() {
  const child = spawn('/bin/sh', [UNINSTALL_WATCH], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => console.error('uninstall watch failed:', e.message));
  child.unref();
}

if (isElevated()) {
  try { installBootHook(); } catch (e) { console.error('boot hook install failed:', e.message); }
  try { startUninstallWatch(); } catch (e) { console.error('uninstall watch failed:', e.message); }
  for (const f of FEATURES) {
    if (!f.init) continue;
    try { f.init(ctx); } catch (e) { console.error(f.name + ' init failed:', e.message); }
  }
}
