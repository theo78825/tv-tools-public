// Hide rows on the LG home screen (service: features/home.js).
// One button per element; the list of elements comes from the service.
TVTools.register({
  id: 'home',

  mount: function (card, api) {
    card.innerHTML =
      '<div class="text">' +
      '  <p class="eyebrow">Home screen</p>' +
      '  <h2>Hide rows</h2>' +
      '  <p class="desc">Checking the home screen.</p>' +
      '</div>' +
      '<div class="toggles"></div>';
    this.api = api;
    this.desc = card.querySelector('.desc');
    this.toggles = card.querySelector('.toggles');
    this.buttons = {};
    this.busy = false;
  },

  update: function (s) {
    var self = this;
    (s.elements || []).forEach(function (el) {
      var b = self.buttons[el.id];
      if (!b) {
        b = document.createElement('button');
        b.className = 'toggle';
        b.innerHTML = '<span class="label"></span><span class="pill"></span>';
        b.addEventListener('click', function () { self.toggle(el.id); });
        self.toggles.appendChild(b);
        self.buttons[el.id] = b;
      }
      b.dataset.hidden = el.hidden ? 'true' : 'false';
      b.querySelector('.label').textContent = el.label;
      b.querySelector('.pill').textContent = el.hidden ? 'Hidden' : 'Shown';
      b.disabled = s.supported === false;
    });

    if (s.supported === false) {
      this.desc.textContent = 'The home screen app has changed since this was tested, so these are turned off.';
    } else if (s.bootDisabled) {
      this.desc.textContent = 'At the last boot the home screen did not start with these changes, ' +
        'so they were undone. Try again, or leave them off.';
    } else {
      this.desc.textContent = 'Changes apply right away and stay after a reboot. ' +
        'Switch a row back on here to bring it back.';
    }
  },

  toggle: function (id) {
    var self = this;
    var b = this.buttons[id];
    if (this.busy || !b) return;
    // Buttons stay enabled so focus stays put; `busy` ignores extra presses.
    this.busy = true;
    b.querySelector('.pill').textContent = 'Applying…';
    this.api.luna('setHomeElement', { id: id, hidden: b.dataset.hidden !== 'true' })
      .then(function () { self.api.showError(''); }, self.api.showError)
      .then(function () {
        self.busy = false;
        return self.api.refresh();
      })
      .then(function () { b.focus(); });
  },
});
