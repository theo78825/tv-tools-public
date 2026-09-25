// Remote key hook: the Home button goes straight to our home screen, so LG's
// never starts first. It only takes the key while the Home screen card's
// redirect is on, so that card stays the one "which Home" switch.
//
// key-hook.py does the work: it takes an exclusive grab of the device the real
// remote sends on and forwards everything to an idle sibling device LG also
// reads, dropping the keys we claim. Nothing of LG's is patched or restarted, and
// the kernel returns the remote to stock the moment that process exits — so
// stopping it is always safe, and `running` false with `enabled` true is the
// state worth showing as broken. The README has why it works this way.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOOK = path.join(__dirname, '..', 'key-hook.py');
const PIDFILE = '/tmp/tv-tools-keyhook.pid';

const enabled = (ctx) => ctx.readState('key-hook') === 'on';

function running() {
  try {
    const pid = parseInt(fs.readFileSync(PIDFILE, 'utf8'), 10);
    return pid > 0 && fs.existsSync('/proc/' + pid);
  } catch (e) { return false; }
}

function start() {
  try {
    const child = spawn('python3', [HOOK], { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* status reports it not running */ });
    child.unref();
  } catch (e) { /* ignore */ }
}

function stop() {
  // Killing it is the safe direction: the grab is dropped with our fd, so the
  // remote is back to stock immediately.
  try { process.kill(parseInt(fs.readFileSync(PIDFILE, 'utf8'), 10)); } catch (e) { /* not running */ }
  fs.rmSync(PIDFILE, { force: true });
}

module.exports = {
  name: 'keyhook',

  init(ctx) {
    if (enabled(ctx) && !running()) start();
  },

  status(ctx) {
    return { enabled: enabled(ctx), running: running() };
  },

  methods: {
    setKeyHook(payload, ctx) {
      if (typeof payload.enabled !== 'boolean') throw new Error('"enabled" must be true or false');
      ctx.requireRoot();
      ctx.writeState('key-hook', payload.enabled ? 'on' : 'off');
      if (payload.enabled) start();
      else stop();
      return { enabled: payload.enabled };
    }
  },
};
