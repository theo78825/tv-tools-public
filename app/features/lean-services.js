// Leaner LG, second card (service: features/lean.js): LG background services,
// kept from running until switched back on. "Off" is the lean state.
TVTools.register({
  id: 'lean',
  card: 'lean-services',

  mount: function (card, api) {
    card.classList.add('lean', 'compact');
    card.innerHTML =
      '<div class="text">' +
      '  <p class="eyebrow">Leaner LG</p>' +
      '  <h2>LG background services</h2>' +
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
    var list = s.services || [];
    list.forEach(function (svc) {
      var b = self.buttons[svc.id];
      if (!b) {
        b = document.createElement('button');
        b.className = 'toggle';
        b.innerHTML = '<span class="label"><span class="name"></span><span class="sub"></span></span><span class="pill"></span>';
        b.addEventListener('click', function () { self.toggle(svc.id); });
        self.toggles.appendChild(b);
        self.buttons[svc.id] = b;
      }
      b.dataset.off = svc.off ? 'true' : 'false';
      b.querySelector('.name').textContent = svc.label;
      b.querySelector('.sub').textContent = svc.desc;
      b.querySelector('.pill').textContent = svc.off ? 'Off' : 'On';
    });
    var off = list.filter(function (svc) { return svc.off; }).length;
    this.title.textContent = off + ' of ' + list.length + ' LG services off';
    if (s.tripped) {
      this.desc.textContent = 'Put back on after a restart: ' + s.tripped.replace(/^[\d-]+ [\d:]+: /, '') +
        '. Switch one off to try again.';
    } else if (s.tested === false) {
      this.desc.textContent = 'This firmware isn’t the one these were tested on, so they stay on.';
    } else {
      this.desc.textContent = 'Kept from running until switched back on. The app store needs sdx, so it isn’t here.';
    }
  },

  toggle: function (id) {
    var self = this;
    var b = this.buttons[id];
    if (this.busy || !b) return;
    // Buttons stay enabled so focus stays put; `busy` ignores extra presses.
    this.busy = true;
    b.querySelector('.pill').textContent = '…';
    this.api.luna('setLeanService', { id: id, off: b.dataset.off !== 'true' })
      .then(function () { self.api.showError(''); }, self.api.showError)
      .then(function () {
        self.busy = false;
        return self.api.refresh();
      })
      .then(function () { b.focus(); });
  },
});
