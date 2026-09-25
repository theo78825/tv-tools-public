// TV Tools app shell: Luna calls, D-pad focus, the confirm dialog, and the
// feature registry. Each features/*.js calls TVTools.register({...}):
//   id      key of the feature's section in the service's `status` reply
//   card    optional card name when two cards share one `id` (default: id)
//   mount   (card, api) => void   build the card's contents
//   update  (featureStatus, fullStatus) => void   redraw from fresh status
(function () {
  var SERVICE = 'luna://io.github.theo78825.tvtools.service/';

  var cardsEl = document.getElementById('cards');
  var errorEl = document.getElementById('error');
  var dialogEl = document.getElementById('dialog');
  var features = [];
  var bridges = []; // keep PalmServiceBridge objects alive until they answer
  var closeDialog = null;
  var status = null;

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

  // "3:27 PM" today, "yesterday 3:27 PM", else "Sep 22, 3:27 PM".
  function formatTime(ms) {
    var d = new Date(ms);
    var h = d.getHours(), m = d.getMinutes();
    var time = ((h + 11) % 12 + 1) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
    var today = new Date();
    var yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return time;
    if (d.toDateString() === yesterday.toDateString()) return 'yesterday ' + time;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + time;
  }

  function showError(err) {
    errorEl.textContent = err ? (err.message || String(err)) : '';
  }

  // Right after a deploy, elevate-service restarts the service as root, and a
  // status call can still reach the old copy. So when it says "not elevated",
  // look again a few times before leaving the warning up.
  var elevationRetries = 0;

  function refresh() {
    return luna('status').then(function (res) {
      status = res;
      if (res.elevated === false && elevationRetries < 10) {
        elevationRetries++;
        setTimeout(refresh, 3000);
      } else if (res.elevated !== false) {
        elevationRetries = 0;
      }
      showError(res.elevated === false
        ? 'Service is not elevated yet. Changes will fail until it is.'
        : '');
      showNetwork(res.network);
      features.forEach(function (f) {
        if (f.update) f.update(res[f.id] || {}, res);
      });
    }, showError);
  }

  // The TV's address in the header, e.g. "192.168.0.20" / "Wi-Fi · MyNetwork, 5 GHz".
  function showNetwork(n) {
    var el = document.getElementById('net');
    if (!el || !n) return;
    el.querySelector('.ip').textContent = n.ip || 'No network';
    el.querySelector('.via').textContent = [n.via, n.ssid, n.band].filter(Boolean).join(' · ');
  }

  // Resolves true if the user picks the OK button, false on Cancel or Back.
  function confirm(opts) {
    var ok = document.getElementById('dialog-ok');
    var cancel = document.getElementById('dialog-cancel');
    var returnFocus = document.activeElement;
    document.getElementById('dialog-title').textContent = opts.title;
    document.getElementById('dialog-body').textContent = opts.body || '';
    ok.textContent = opts.okLabel || 'OK';
    dialogEl.classList.add('open');
    cancel.focus();
    return new Promise(function (resolve) {
      function done(answer) {
        ok.onclick = cancel.onclick = null;
        closeDialog = null;
        dialogEl.classList.remove('open');
        if (returnFocus) returnFocus.focus();
        resolve(answer);
      }
      ok.onclick = function () { done(true); };
      cancel.onclick = function () { done(false); };
      closeDialog = function () { done(false); };
    });
  }

  // Arrow keys walk the enabled buttons in the open dialog, or on the page.
  function focusables() {
    var scope = closeDialog ? dialogEl : cardsEl;
    return Array.prototype.filter.call(scope.querySelectorAll('button'), function (b) {
      return !b.disabled;
    });
  }

  function move(step) {
    var list = focusables();
    if (!list.length) return;
    var i = list.indexOf(document.activeElement);
    i = i === -1 ? 0 : Math.max(0, Math.min(list.length - 1, i + step));
    focusEl(list[i]);
  }

  // Focus a button and scroll its card into view when the list overflows.
  function focusEl(el) {
    el.focus();
    var card = el.closest('.card');
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function ensureFocus() {
    var list = focusables();
    if (list.length && list.indexOf(document.activeElement) === -1) focusEl(list[0]);
  }

  document.addEventListener('keydown', function (e) {
    switch (e.keyCode) {
      case 13: // OK / Enter
        e.preventDefault();
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
          document.activeElement.click();
        } else {
          ensureFocus();
        }
        break;
      case 38: case 37: // Up, Left
        e.preventDefault();
        move(-1);
        break;
      case 40: case 39: // Down, Right
        e.preventDefault();
        move(1);
        break;
      case 461: // Back
      case 27:
        e.preventDefault();
        if (closeDialog) closeDialog();
        else if (TVView.fromHome) TVView.go('home');
        else window.close();
        break;
    }
  });

  document.addEventListener('webOSRelaunch', function (e) {
    if (!TVView.relaunch(e)) refresh();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  var api = {
    luna: luna,
    formatTime: formatTime,
    refresh: refresh,
    confirm: confirm,
    showError: showError,
    ensureFocus: ensureFocus,
  };

  window.TVTools = {
    register: function (feature) { features.push(feature); },
    start: function () {
      features.forEach(function (f) {
        var card = document.createElement('section');
        card.className = 'card';
        card.id = 'card-' + (f.card || f.id);
        cardsEl.appendChild(card);
        f.mount(card, api);
      });
      refresh().then(ensureFocus);
    },
  };
})();
