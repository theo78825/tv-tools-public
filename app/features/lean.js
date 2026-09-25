// Leaner LG (service: features/lean.js): switch off LG extras you don't use.
// One toggle per item; "Off" is the lean state.
TVTools.register({
  id: 'lean',

  mount: function (card, api) {
    card.classList.add('lean');
    card.innerHTML =
      '<div class="text">' +
      '  <p class="eyebrow">Leaner LG</p>' +
      '  <h2>Switch off LG extras</h2>' +
      '  <p class="desc">Checking.</p>' +
      '</div>' +
      '<div class="toggles"></div>';
    this.api = api;
    this.title = card.querySelector('h2');
    this.desc = card.querySelector('.desc');
    this.toggles = card.querySelector('.toggles');
    this.buttons = {};
    this.busy = false;
  },

  update: function (s) {
    var self = this;
    var list = s.switches || [];
    list.forEach(function (sw) {
      var b = self.buttons[sw.id];
      if (!b) {
        b = document.createElement('button');
        b.className = 'toggle';
        b.innerHTML = '<span class="label"><span class="name"></span><span class="sub"></span></span><span class="pill"></span>';
        b.addEventListener('click', function () { self.toggle(sw.id); });
        self.toggles.appendChild(b);
        self.buttons[sw.id] = b;
      }
      b.dataset.off = sw.off ? 'true' : 'false';
      b.querySelector('.name').textContent = sw.label;
      b.querySelector('.sub').textContent = sw.desc;
      b.querySelector('.pill').textContent = sw.off ? 'Off' : sw.known ? 'On' : '?';
    });
    var off = list.filter(function (sw) { return sw.off; }).length;
    this.title.textContent = off === list.length ? 'All LG extras off' : off + ' of ' + list.length + ' LG extras off';
    // The last time LG turned one back on (lean-watch.sh / boot re-check), if
    // within a week; otherwise what the card does.
    var fix = s.lastFix;
    this.desc.textContent = fix && Date.now() - fix.at < 7 * 24 * 3600 * 1000
      ? 'LG turned ' + fix.labels.join(', ') + ' back on at ' + this.api.formatTime(fix.at) + ', so it was switched off again.'
      : 'LG’s own settings. Switch one back on any time; TV Tools keeps the others off.';
  },

  toggle: function (id) {
    var self = this;
    var b = this.buttons[id];
    if (this.busy || !b) return;
    // Buttons stay enabled so focus stays put; `busy` ignores extra presses.
    this.busy = true;
    b.querySelector('.pill').textContent = '…';
    this.api.luna('setLeanSwitch', { id: id, off: b.dataset.off !== 'true' })
      .then(function () { self.api.showError(''); }, self.api.showError)
      .then(function () {
        self.busy = false;
        return self.api.refresh();
      })
      .then(function () { b.focus(); });
  },
});
