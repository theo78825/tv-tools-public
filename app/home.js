// Home screen (TV Tools' other screen, see view.js): a large first row of
// favourite apps, then a grid of everything else. App list, icons and launching
// come from the TV Tools service (features/launcher.js), because a web app
// can't read other apps' icon files.
//
// Hold OK on a tile for its menu: Move, Rename, Hide (or Unhide), Reset name.
// Hidden apps sit behind a "Hidden apps" tile at the end of the grid.
(function () {
  var SERVICE = 'luna://io.github.theo78825.tvtools.service/';
  var ICON_CACHE = 'home-icon:'; // localStorage prefix; icons show instantly after a restart
  var GRID_COLS = 8;
  var HOLD_MS = 700;

  var mainEl = document.getElementById('main');
  var topEl = document.getElementById('top');
  var gridEl = document.getElementById('grid');
  var errorEl = document.getElementById('error');
  var bridges = [];   // keep PalmServiceBridge objects alive until they answer
  var apps = {};      // app id -> app from the service
  var tiles = {};     // app id -> tile button
  var order = [];     // visible app ids in tile order; the first topCount are the big row
  var hiddenIds = []; // hidden app ids, in order
  var topCount = 5;
  var showHidden = false;
  var hiddenToggle = null;
  var iconsLoaded = {};

  function luna(method, params) {
    return new Promise(function (resolve, reject) {
      if (typeof PalmServiceBridge === 'undefined') {
        reject(new Error('Not running on webOS (PalmServiceBridge missing).'));
        return;
      }
      var bridge = new PalmServiceBridge();
      bridges.push(bridge);
      bridge.onservicecallback = function (msg) {
        bridges.splice(bridges.indexOf(bridge), 1);
        var res;
        try { res = JSON.parse(msg); } catch (e) { reject(e); return; }
        if (res.returnValue === false) reject(new Error(res.errorText || 'Service call failed'));
        else resolve(res);
      };
      bridge.call(SERVICE + method, JSON.stringify(params || {}));
    });
  }

  function showError(err) { errorEl.textContent = err ? (err.message || String(err)) : ''; }

  function cacheGet(id) { try { return localStorage.getItem(ICON_CACHE + id); } catch (e) { return null; } }
  function cacheSet(id, v) { try { localStorage.setItem(ICON_CACHE + id, v); } catch (e) { /* full or blocked */ } }

  // ---- Tiles ----

  function normColor(c) {
    if (!c) return '#2a2a31';
    return c.charAt(0) === '#' ? c : '#' + c;
  }

  // Near-black tiles (Hulu, Apple TV, Plex...) vanish into the page background.
  function isDark(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
    if (!m) return false;
    var lum = 0.2126 * parseInt(m[1], 16) + 0.7152 * parseInt(m[2], 16) + 0.0722 * parseInt(m[3], 16);
    return lum < 40;
  }

  function makeTile(app) {
    var b = document.createElement('button');
    b.className = 'tile' + (app.hidden ? ' is-hidden' : '');
    b.setAttribute('data-nav', '');
    b.setAttribute('data-launch', app.id);
    b.innerHTML = '<span class="face"><span class="initial"></span></span><span class="name"></span>';
    b.querySelector('.face').style.background = normColor(app.bgColor);
    if (isDark(normColor(app.bgColor))) b.classList.add('dark');
    b.querySelector('.initial').textContent = (app.title || '?').charAt(0);
    b.querySelector('.name').textContent = app.title;
    var cached = cacheGet(app.id);
    if (cached) setIcon(b, cached);
    return b;
  }

  function setIcon(tile, src) {
    var face = tile.querySelector('.face');
    var img = face.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      face.innerHTML = '';
      face.appendChild(img);
    }
    img.src = src;
  }

  function render(list) {
    apps = {};
    list.apps.forEach(function (a) { apps[a.id] = a; });
    topCount = list.topCount || 5;
    order = list.apps.filter(function (a) { return !a.hidden; }).map(function (a) { return a.id; });
    hiddenIds = list.apps.filter(function (a) { return a.hidden; }).map(function (a) { return a.id; });
    if (!hiddenIds.length) showHidden = false;

    var focusedId = document.activeElement && document.activeElement.getAttribute('data-launch');
    var toggleFocused = document.activeElement === hiddenToggle;
    topEl.innerHTML = '';
    gridEl.innerHTML = '';
    tiles = {};
    list.apps.forEach(function (a) { tiles[a.id] = makeTile(a); });
    hiddenToggle = document.createElement('button');
    hiddenToggle.className = 'tile toggle-hidden';
    hiddenToggle.setAttribute('data-nav', '');
    hiddenToggle.setAttribute('data-action', 'toggleHidden');
    hiddenToggle.innerHTML = '<span class="face"></span><span class="name"></span>';
    layout();
    if (focusedId && tiles[focusedId] && tiles[focusedId].isConnected) tiles[focusedId].focus();
    else if (toggleFocused && hiddenToggle.isConnected) hiddenToggle.focus();
    loadIcons(order.concat(hiddenIds));
  }

  // Put the existing tiles in `order`: the first topCount go in the big row.
  // Re-appending moves elements, so icons and focus survive a reorder.
  function layout() {
    order.forEach(function (id, i) {
      (i < topCount ? topEl : gridEl).appendChild(tiles[id]);
    });
    hiddenIds.forEach(function (id) {
      var t = tiles[id];
      if (showHidden) gridEl.appendChild(t);
      else if (t.parentNode) t.parentNode.removeChild(t);
    });
    if (hiddenIds.length) {
      hiddenToggle.querySelector('.face').textContent = showHidden ? '⌃' : '+' + hiddenIds.length;
      hiddenToggle.querySelector('.name').textContent = showHidden ? 'Hide hidden apps' : 'Hidden apps';
      // The toggle sits between the visible apps and the hidden ones.
      if (showHidden && hiddenIds.length) gridEl.insertBefore(hiddenToggle, tiles[hiddenIds[0]]);
      else gridEl.appendChild(hiddenToggle);
    } else if (hiddenToggle.parentNode) {
      hiddenToggle.parentNode.removeChild(hiddenToggle);
    }
  }

  // Fetch icons a few at a time; refresh cached ones once per page load.
  function loadIcons(ids) {
    var queue = ids.filter(function (id) { return !iconsLoaded[id]; });
    function next() {
      var id = queue.shift();
      if (!id) return null;
      iconsLoaded[id] = true;
      return luna('getAppIcon', { id: id }).then(function (res) {
        if (res.icon) {
          cacheSet(id, res.icon);
          if (tiles[id]) setIcon(tiles[id], res.icon);
        }
      }, function () { /* keep the initial */ }).then(next);
    }
    for (var i = 0; i < 4; i++) next();
  }

  var lastList = '';
  // A call is cut off if TV Tools' service restarts mid-request (a deploy, or
  // LG's hub restarting it), and webOS then answers "Message status unknown."
  // Try again a few times before showing an error, so a restart doesn't leave
  // one on screen.
  var refreshRetries = 0;
  function refresh() {
    if (moving || overlay) return Promise.resolve(); // don't rebuild under a move or a menu
    return luna('listHomeApps').then(function (list) {
      refreshRetries = 0;
      showError('');
      var json = JSON.stringify(list);
      if (json !== lastList) { lastList = json; render(list); } // no rebuild (or flicker) if nothing changed
    }, function (err) {
      if (refreshRetries < 5) {
        refreshRetries++;
        setTimeout(refresh, 2000);
        return;
      }
      refreshRetries = 0;
      showError(err);
    });
  }

  function reload() { lastList = ''; return refresh(); }

  // ---- Focus and navigation ----

  var overlay = null; // the open menu or dialog element, if any

  function navItems() {
    var scope = overlay || document;
    return Array.prototype.filter.call(scope.querySelectorAll('[data-nav]'), function (el) {
      return overlay || !el.closest('.overlay');
    });
  }

  function focusEl(el) {
    el.focus();
    if (mainEl.contains(el)) {
      if (topEl.contains(el)) mainEl.scrollTop = 0;
      else el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (!overlay) {
      mainEl.scrollTop = 0;
    }
  }

  function resetFocus() {
    var first = topEl.querySelector('.tile') || gridEl.querySelector('.tile') || navItems()[0];
    if (first) focusEl(first);
    mainEl.scrollTop = 0;
  }

  // Spatial navigation: the nearest item in the pressed direction, preferring
  // items lined up with the current one.
  function move(dir) {
    var cur = document.activeElement;
    var items = navItems();
    if (items.indexOf(cur) === -1) { if (items[0]) focusEl(items[0]); return; }
    var a = cur.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = null, bestScore = Infinity;
    items.forEach(function (el) {
      if (el === cur) return;
      var b = el.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var dx = bx - ax, dy = by - ay, main, cross;
      if (dir === 'left') { main = -dx; cross = dy; }
      else if (dir === 'right') { main = dx; cross = dy; }
      else if (dir === 'up') { main = -dy; cross = dx; }
      else { main = dy; cross = dx; }
      if (main <= 1) return;
      var score = main + Math.abs(cross) * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) focusEl(best);
  }

  function launch(el) {
    var id = el.getAttribute('data-launch');
    if (!id) return;
    if (id === TVView.appId) { TVView.go('tools'); return; } // TV Tools' tile: same app, other page
    el.classList.add('launching');
    setTimeout(function () { el.classList.remove('launching'); }, 1200);
    luna('launchApp', { id: id }).catch(showError);
  }

  function activate(el) {
    var action = el.getAttribute('data-action');
    if (action) actions[action](el);
    else launch(el);
  }

  // ---- Tile menu and rename dialog ----

  var menuEl = document.getElementById('menu');
  var renameEl = document.getElementById('rename');
  var renameInput = document.getElementById('rename-input');
  var menuFor = null; // app id the menu or dialog is about

  function openOverlay(el, focus) {
    overlay = el;
    el.classList.add('open');
    focusEl(focus || navItems()[0]);
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay = null;
    if (document.activeElement) document.activeElement.blur();
    var t = menuFor && tiles[menuFor];
    if (t && t.isConnected) focusEl(t);
    else resetFocus();
  }

  function openMenu(tile) {
    var id = tile.getAttribute('data-launch');
    var app = apps[id];
    if (!app) return;
    menuFor = id;
    document.getElementById('menu-title').textContent = app.title;
    var items = [];
    if (!app.hidden) items.push(['move', 'Move']);
    items.push(['rename', 'Rename']);
    if (app.renamed) items.push(['resetName', 'Use LG’s name (' + app.lgTitle + ')']);
    items.push(app.hidden ? ['unhide', 'Unhide'] : ['hide', 'Hide']);
    items.push(['closeOverlay', 'Cancel']);
    var list = document.getElementById('menu-actions');
    list.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'pill menu-item';
      b.setAttribute('data-nav', '');
      b.setAttribute('data-action', it[0]);
      b.textContent = it[1];
      list.appendChild(b);
    });
    openOverlay(menuEl);
  }

  function openRename() {
    var app = apps[menuFor];
    menuEl.classList.remove('open');
    document.getElementById('rename-app').textContent = app.lgTitle;
    document.getElementById('rename-lg').textContent = app.lgTitle;
    renameInput.value = app.title;
    openOverlay(renameEl, renameInput); // focusing the input brings up LG's keyboard
  }

  function saveRename() {
    var id = menuFor;
    var name = renameInput.value.trim();
    renameInput.blur();
    closeOverlay();
    luna('setAppName', { id: id, name: name === apps[id].lgTitle ? '' : name })
      .then(reload, showError)
      .then(function () { if (tiles[id]) focusEl(tiles[id]); });
  }

  // Hide or unhide, then keep focus nearby.
  function setHidden(hidden) {
    var id = menuFor;
    var i = order.indexOf(id);
    closeOverlay();
    luna('setAppHidden', { id: id, hidden: hidden }).then(reload, showError).then(function () {
      if (hidden) {
        var next = order[Math.min(i, order.length - 1)];
        if (next && tiles[next]) focusEl(tiles[next]); else resetFocus();
      } else if (tiles[id]) {
        focusEl(tiles[id]);
      }
    });
  }

  var actions = {
    move: function () {
      var t = tiles[menuFor];
      closeOverlay();
      if (t) startMove(t);
    },
    rename: openRename,
    saveRename: saveRename,
    resetName: function () {
      var id = menuFor;
      closeOverlay();
      luna('setAppName', { id: id, name: '' }).then(reload, showError)
        .then(function () { if (tiles[id]) focusEl(tiles[id]); });
    },
    hide: function () { setHidden(true); },
    unhide: function () { setHidden(false); },
    closeOverlay: closeOverlay,
    toggleHidden: function () {
      showHidden = !showHidden;
      layout();
      focusEl(showHidden && hiddenIds.length ? tiles[hiddenIds[0]] : hiddenToggle);
    },
  };

  // ---- Moving tiles ----

  var moving = null; // { id, before } while a tile is picked up
  var moveBanner = document.getElementById('moving');

  function startMove(tile) {
    var id = tile.getAttribute('data-launch');
    if (!tiles[id] || order.indexOf(id) === -1) return;
    moving = { id: id, before: order.slice() };
    tile.classList.add('lifted');
    document.body.classList.add('arranging');
    moveBanner.querySelector('b').textContent = tile.querySelector('.name').textContent;
    focusEl(tile);
  }

  function endMove(save) {
    if (!moving) return;
    var id = moving.id;
    if (!save) { order = moving.before; layout(); }
    tiles[id].classList.remove('lifted');
    document.body.classList.remove('arranging');
    var changed = moving.before.join(' ') !== order.join(' ');
    moving = null;
    focusEl(tiles[id]);
    if (save && changed) {
      lastList = ''; // next refresh redraws from the saved order
      luna('setHomeOrder', { order: order.concat(hiddenIds) }).catch(showError);
    }
  }

  // Where a tile at index i lands when moved in a direction. Left/right step
  // through the whole order (crossing between rows); up/down jump a row.
  function targetIndex(i, dir) {
    var n = order.length;
    if (dir === 'left') return Math.max(0, i - 1);
    if (dir === 'right') return Math.min(n - 1, i + 1);
    if (i < topCount) { // big row
      return dir === 'down' ? Math.min(n - 1, topCount + Math.min(i, GRID_COLS - 1)) : i;
    }
    var j = i - topCount, row = Math.floor(j / GRID_COLS), col = j % GRID_COLS;
    if (dir === 'up') return row === 0 ? Math.min(col, topCount - 1) : i - GRID_COLS;
    return Math.min(n - 1, i + GRID_COLS);
  }

  function moveTile(dir) {
    var i = order.indexOf(moving.id);
    var t = targetIndex(i, dir);
    if (t === i) return;
    order.splice(i, 1);
    order.splice(t, 0, moving.id);
    layout();
    focusEl(tiles[moving.id]);
  }

  // ---- Keys ----
  // OK acts on release, so a short press opens the app and a hold opens the
  // tile's menu instead.

  var DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  var okDown = false, holdTimer = null, holdFired = false;

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;

    // Typing a name: the input (and LG's keyboard) gets everything except
    // Enter (save), Back (cancel) and up/down (to the buttons).
    if (document.activeElement === renameInput) {
      if (code === 13) { e.preventDefault(); saveRename(); }
      else if (code === 461 || code === 27) { e.preventDefault(); closeOverlay(); }
      else if (code === 38 || code === 40) { e.preventDefault(); move(DIRS[code]); }
      return;
    }

    if (DIRS[code]) {
      e.preventDefault();
      if (okDown) return; // ignore arrows while OK is held
      if (moving) moveTile(DIRS[code]);
      else move(DIRS[code]);
      return;
    }
    if (code === 13) {
      e.preventDefault();
      if (okDown) return; // key repeat while held
      okDown = true;
      holdFired = false;
      var el = document.activeElement;
      if (!moving && !overlay && el && el.hasAttribute('data-launch') && el.classList.contains('tile')) {
        holdTimer = setTimeout(function () { holdFired = true; openMenu(el); }, HOLD_MS);
      }
      return;
    }
    if (code === 461 || code === 27) {
      e.preventDefault(); // this is the home screen: Back only closes things
      if (moving) endMove(false);
      else if (overlay) closeOverlay();
    }
  });

  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== 13) return;
    e.preventDefault();
    clearTimeout(holdTimer);
    var wasDown = okDown;
    okDown = false;
    if (!wasDown) return;
    if (holdFired) { holdFired = false; return; } // this press opened the menu
    if (moving) { endMove(true); return; }
    var el = document.activeElement;
    if (navItems().indexOf(el) !== -1 && el !== renameInput) activate(el);
    else if (!overlay) resetFocus();
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-launch], [data-action]');
    if (el && el !== renameInput) activate(el);
  });

  // Each Home press relaunches us: start from the first big tile, like LG's.
  // Any other launch of TV Tools means its cards.
  document.addEventListener('webOSRelaunch', function (e) {
    if (TVView.relaunch(e)) return;
    endMove(false);
    closeOverlay();
    resetFocus();
    refresh();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });

  // ---- Clock ----

  function tick() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    document.getElementById('time').textContent =
      ((h + 11) % 12 + 1) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
    document.getElementById('date').textContent = d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }
  tick();
  setInterval(tick, 10000);

  refresh().then(resetFocus);
})();
