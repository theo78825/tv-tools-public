// Backend for the home screen (app/home.html) and the Home-button redirect.
//
// The home screen is a plain web page, which webOS won't let read other apps'
// icon files, so this service lists the launch points, hands icons over as
// data URLs, and launches apps.
//
// Redirect: boot.d/launcher.sh watches the foreground app and opens our home
// screen (TV Tools, launched with {"view":"home"}) whenever LG Home comes to the
// front. LG's home app and the Home key are untouched. Turning the redirect off here, or the watcher's loop guard
// (which writes TRIPPED), leaves the stock LG behaviour.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const AM = 'luna://com.webos.applicationManager';
const APP_ID = 'io.github.theo78825.tvtools';
const LG_HOME = 'com.webos.app.home';
const WATCHER = path.join(__dirname, '..', 'boot.d', 'launcher.sh');
const PIDFILE = '/tmp/tv-tools-redirect.pid';
const PAUSE = '/tmp/tv-tools-redirect-pause';        // "LG Home" tile: skip redirects until another app opens
const TRIPPED = '/var/lib/tv-tools/redirect-tripped'; // written by the watcher's loop guard
const LOG = '/tmp/tv-tools-redirect.log';             // watcher start-up output (RAM, cleared on reboot)
const TOP_COUNT = 5;
// Never picked for the default top row (LG's store tile is first in LG's order).
const NOT_TOP_BY_DEFAULT = new Set(['com.webos.app.discovery', APP_ID, 'org.webosbrew.hbchannel']);

let cache = null; // { at, points } — listLaunchPoints is slowish, and icons are fetched one by one

async function launchPoints(ctx, fresh) {
  if (!fresh && cache && Date.now() - cache.at < 30000) return cache.points;
  const res = await ctx.call(`${AM}/listLaunchPoints`, {});
  const points = res.launchPoints || [];
  cache = { at: Date.now(), points };
  return points;
}

// The home screen's tile order: the first TOP_COUNT are the big top row. Uses
// the order saved by setHomeOrder; apps installed since then go at the end
// (in LG's order), and uninstalled ones drop out.
function orderedIds(ctx, points) {
  const ids = points.map((p) => p.id);
  const known = new Set(ids);
  const saved = (ctx.readState('home-order') || '').split(/\s+/).filter((id) => known.has(id));
  if (saved.length) {
    const seen = new Set(saved);
    return saved.concat(ids.filter((id) => !seen.has(id)));
  }
  const top = points.filter((p) => !NOT_TOP_BY_DEFAULT.has(p.id)).slice(0, TOP_COUNT).map((p) => p.id);
  return top.concat(ids.filter((id) => !top.includes(id)));
}

const MAX_NAME = 40;

function readNames(ctx) {
  try { return JSON.parse(ctx.readState('home-names') || '{}'); } catch (e) { return {}; }
}

function readHiddenApps(ctx) {
  return (ctx.readState('home-hidden-apps') || '').split(/\s+/).filter(Boolean);
}

function watcherRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PIDFILE, 'utf8'), 10);
    return pid > 0 && fs.existsSync('/proc/' + pid);
  } catch (e) { return false; }
}

function startWatcher() {
  if (watcherRunning()) return;
  let log = 'ignore';
  try { log = fs.openSync(LOG, 'a'); } catch (e) { /* run without a log */ }
  const child = spawn('/bin/sh', [WATCHER], { detached: true, stdio: ['ignore', log, log] });
  child.on('error', (err) => {
    try { fs.appendFileSync(LOG, `${new Date().toISOString()} spawn failed: ${err.message}\n`); } catch (e) { /* ignore */ }
  });
  child.unref();
  if (typeof log === 'number') fs.closeSync(log);
}

module.exports = {
  name: 'launcher',

  init(ctx) {
    if (ctx.readState('redirect') === 'on') startWatcher();
  },

  async status(ctx) {
    let tripped = null;
    try { tripped = fs.readFileSync(TRIPPED, 'utf8').trim(); } catch (e) { /* not tripped */ }
    return {
      redirect: ctx.readState('redirect') === 'on',
      watcher: watcherRunning(),
      tripped,
    };
  },

  methods: {
    // Everything the home screen needs to draw: all apps in tile order (hidden
    // ones flagged), with custom names applied. The first topCount visible
    // apps are the big row.
    async listHomeApps(payload, ctx) {
      const points = await launchPoints(ctx, true);
      const byId = new Map(points.map((p) => [p.id, p]));
      const names = readNames(ctx);
      const hidden = new Set(readHiddenApps(ctx));
      return {
        topCount: TOP_COUNT,
        apps: orderedIds(ctx, points).map((id) => {
          const p = byId.get(id);
          return {
            id: p.id,
            title: names[p.id] || p.title,
            lgTitle: p.title,
            renamed: !!names[p.id],
            hidden: hidden.has(p.id),
            bgColor: p.bgColor || p.iconColor || '',
          };
        }),
      };
    },

    // A custom name for an app's tile; an empty name goes back to LG's.
    async setAppName(payload, ctx) {
      if (typeof payload.id !== 'string' || !payload.id) throw new Error('"id" is required');
      const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, MAX_NAME) : '';
      const names = readNames(ctx);
      if (name) names[payload.id] = name;
      else delete names[payload.id];
      ctx.writeState('home-names', JSON.stringify(names));
      return {};
    },

    async setAppHidden(payload, ctx) {
      if (typeof payload.id !== 'string' || !payload.id) throw new Error('"id" is required');
      if (typeof payload.hidden !== 'boolean') throw new Error('"hidden" must be true or false');
      const hidden = new Set(readHiddenApps(ctx));
      if (payload.hidden) hidden.add(payload.id);
      else hidden.delete(payload.id);
      ctx.writeState('home-hidden-apps', Array.from(hidden).join(' '));
      return {};
    },

    // Save the home screen's tile order (all ids, top row first).
    async setHomeOrder(payload, ctx) {
      const order = payload.order;
      if (!Array.isArray(order) || !order.every((id) => typeof id === 'string' && /^[\w.-]+$/.test(id))) {
        throw new Error('"order" must be a list of app ids');
      }
      ctx.writeState('home-order', order.join(' '));
      return {};
    },

    async getAppIcon(payload, ctx) {
      const lp = (await launchPoints(ctx, false)).find((p) => p.id === payload.id);
      if (!lp) throw new Error('Unknown app: ' + payload.id);
      for (const file of [lp.extraLargeIcon, lp.largeIcon, lp.mediumLargeIcon, lp.icon]) {
        if (!file) continue;
        try {
          const data = fs.readFileSync(file);
          const type = file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
          return { id: lp.id, icon: `data:image/${type};base64,${data.toString('base64')}` };
        } catch (e) { /* try the next size */ }
      }
      return { id: lp.id, icon: null };
    },

    async launchApp(payload, ctx) {
      if (typeof payload.id !== 'string' || !payload.id) throw new Error('"id" is required');
      if (payload.id === LG_HOME) fs.writeFileSync(PAUSE, String(Date.now()));
      await ctx.call(`${AM}/launch`, { id: payload.id, params: payload.params || {} });
      return {};
    },

    async setRedirect(payload, ctx) {
      if (typeof payload.on !== 'boolean') throw new Error('"on" must be true or false');
      ctx.requireRoot();
      ctx.writeState('redirect', payload.on ? 'on' : 'off');
      fs.rmSync(TRIPPED, { force: true });
      if (payload.on) startWatcher();
      return {};
    },
  },
};
