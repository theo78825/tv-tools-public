// Remote key hook on/off (service: features/keyhook.js). With it on, Home goes
// straight to our Home with no flash of LG's (it follows the Home screen card's
// redirect switch, so that stays the single "which Home" setting).
TVTools.register({
  id: 'keyhook',

  mount: function (card, api) {
    var self = this;
    card.innerHTML =
      '<div class="text">' +
      '  <p class="eyebrow">Home button</p>' +
      '  <h2>Instant Home: <span class="state">…</span></h2>' +
      '  <p class="desc">Checking.</p>' +
      '</div>' +
      '<button>Please wait</button>';
    this.stateEl = card.querySelector('.state');
    this.desc = card.querySelector('.desc');
    this.button = card.querySelector('button');
    this.enabled = null;
    this.busy = false;

    this.button.addEventListener('click', function () {
      if (self.busy || self.enabled === null) return;
      self.busy = true; // button stays enabled so focus stays put
      self.button.textContent = 'Switching…';
      api.luna('setKeyHook', { enabled: !self.enabled })
        .then(function () { api.showError(''); }, api.showError)
        .then(function () { self.busy = false; return api.refresh(); });
    });
  },

  update: function (s) {
    this.enabled = s.enabled === true;
    var stuck = this.enabled && !s.running;
    this.stateEl.textContent = !this.enabled ? 'off' : stuck ? 'not hooked' : 'on';
    this.stateEl.className = 'state ' + (!this.enabled ? 'off' : stuck ? 'warn' : 'on');
    this.button.textContent = this.enabled ? 'Give it back to LG' : 'Take it over';
    this.desc.textContent = !this.enabled
      ? 'With the Home screen card set to ours, LG’s home screen still shows for a moment before ours opens. Take the Home button over and it goes straight to ours.'
      : stuck
        ? 'Switched on, but nothing is watching the button, so LG has it back. Switch it off and on again.'
        : 'Home opens our Home with no flash of LG’s, while the Home screen card is set to ours. Every other button is untouched, and it all goes back to normal at the next restart.';
  },
});
