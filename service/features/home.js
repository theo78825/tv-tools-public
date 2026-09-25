// Hide rows on the LG home screen.
//
// The home app (Flutter, com.webos.app.home) builds its layout at startup from
// XML files on the read-only system partition. We never touch those files: a
// filtered copy lives in STORE and is bind-mounted over the original, then the
// home process is restarted so it rereads the layout. Unmounting (or a reboot
// before boot.d/home.sh reapplies) always brings back LG's stock layout.
//
// Safety rules:
// - Only patch a file whose SHA-256 matches the version this was tested on, so
//   an LG update to the home app turns the feature off instead of guessing.
// - A layout is only saved for boot once the home app has come back up with it
//   live. If it does not, everything is unmounted again and nothing is saved.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ASSETS = '/usr/palm/applications/com.webos.app.home/data/flutter_assets/assets';
const FILES = {
  'home.xml': '8f0bf119efe54285c44e15ed9f608da9f38dd94178e73ec5441f22df3d5aa9d7',
  'home_lg.xml': '53209385d657bbf305c186ae33d01b5a7b67cff0a839ef0da88f2dd3ecc90075',
};
const STORE = '/var/lib/tv-tools/home';      // patched copies + .sha256, read at boot
const DISABLED = STORE + '.disabled';          // boot.d/home.sh moves STORE here if Home fails to start
const HOME_PROC = '^/usr/bin/flutter-client -i com.webos.app.home';

// What the TV Tools card offers, and the layout <item id> each one removes.
const ELEMENTS = [
  { id: 'editRow', label: 'Edit button row', items: ['qcardList'] },
  { id: 'recentInput', label: 'Recent Input & Device Functions', items: ['recommendedShelf'] },
];

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout) => resolve({ ok: !err, out: String(stdout || '').trim() }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readHidden(ctx) {
  const raw = ctx.readState('home-hidden');
  const known = new Set(ELEMENTS.map((e) => e.id));
  return raw ? raw.split(/\s+/).filter((id) => known.has(id)) : [];
}

async function unmountAll() {
  for (const f of Object.keys(FILES)) {
    // Mounts can stack; peel them all off.
    for (let i = 0; i < 5; i++) {
      if (!(await run('umount', [path.join(ASSETS, f)])).ok) break;
    }
  }
}

async function homePid() {
  const r = await run('pgrep', ['-f', HOME_PROC]);
  return r.ok ? r.out.split('\n')[0] : null;
}

// Kill the home process so it rereads the layout. webOS only respawns it by
// itself while Home is in front, so otherwise preload it in the background
// (TV Tools stays in front). Resolves true once a new process has stayed up.
async function restartHome(ctx) {
  const old = await homePid();
  if (old) await run('kill', [old]);
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const pid = await homePid();
    if (pid && pid !== old) {
      await sleep(3000);
      if (await homePid()) return true;
    }
    if (i === 4) {
      await ctx.call('luna://com.webos.applicationManager/launch', {
        id: 'com.webos.app.home',
        preload: 'full',
      }).catch(() => {});
    }
  }
  return false;
}

// True if any of our patched files is bind-mounted over LG's right now.
function applied() {
  let mounts = '';
  try { mounts = fs.readFileSync('/proc/mounts', 'utf8'); } catch (e) { return false; }
  return Object.keys(FILES).some((f) => mounts.includes(' ' + path.join(ASSETS, f) + ' '));
}

function stockOk() {
  return Object.entries(FILES).every(([f, want]) => {
    try { return sha256(fs.readFileSync(path.join(ASSETS, f))) === want; } catch (e) { return false; }
  });
}

async function apply(ctx, hidden) {
  await unmountAll();
  fs.rmSync(STORE, { recursive: true, force: true });
  fs.rmSync(DISABLED, { recursive: true, force: true });

  if (hidden.length) {
    if (!stockOk()) {
      throw new Error('The home screen app has changed since this was tested, so it was left alone.');
    }
    const items = ELEMENTS.filter((e) => hidden.includes(e.id)).flatMap((e) => e.items);
    const drop = new RegExp(`id="(${items.join('|')})"`);
    fs.mkdirSync(STORE, { recursive: true });
    for (const f of Object.keys(FILES)) {
      const src = path.join(ASSETS, f);
      const original = fs.readFileSync(src, 'utf8');
      const patched = original.split('\n').filter((line) => !drop.test(line)).join('\n');
      if (patched === original) continue;
      const dst = path.join(STORE, f);
      fs.writeFileSync(dst, patched);
      if (!(await run('mount', ['--bind', dst, src])).ok) {
        await unmountAll();
        fs.rmSync(STORE, { recursive: true, force: true });
        throw new Error('Could not apply the layout (mount failed). Nothing was changed.');
      }
    }
  }

  if (!(await restartHome(ctx))) {
    // Home did not come back with this layout: return to stock and try again.
    await unmountAll();
    fs.rmSync(STORE, { recursive: true, force: true });
    await restartHome(ctx);
    throw new Error('The home screen did not restart with this layout, so the stock layout was restored.');
  }

  // Only now is the layout known to work; record the stock hashes for boot.
  if (hidden.length) {
    for (const f of Object.keys(FILES)) {
      if (fs.existsSync(path.join(STORE, f))) fs.writeFileSync(path.join(STORE, f + '.sha256'), FILES[f] + '\n');
    }
  }
}

module.exports = {
  name: 'home',

  async status(ctx) {
    const hidden = readHidden(ctx);
    return {
      elements: ELEMENTS.map((e) => ({ id: e.id, label: e.label, hidden: hidden.includes(e.id) })),
      supported: stockOk() || fs.existsSync(STORE),
      applied: applied(),
      // Set by boot.d/home.sh when Home failed to start with the saved layout.
      bootDisabled: fs.existsSync(DISABLED),
    };
  },

  methods: {
    async setHomeElement(payload, ctx) {
      const el = ELEMENTS.find((e) => e.id === payload.id);
      if (!el) throw new Error('Unknown home screen element: ' + payload.id);
      if (typeof payload.hidden !== 'boolean') throw new Error('"hidden" must be true or false');
      ctx.requireRoot();
      const before = readHidden(ctx);
      const hidden = payload.hidden
        ? Array.from(new Set(before.concat(el.id)))
        : before.filter((id) => id !== el.id);
      try {
        await apply(ctx, hidden);
      } catch (err) {
        ctx.writeState('home-hidden', '');
        throw err;
      }
      ctx.writeState('home-hidden', hidden.join(' '));
      return {};
    },
  },
};
