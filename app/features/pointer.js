// Magic Remote pointer on/off (service: features/pointer.js).
TVTools.register({
  id: 'pointer',

  mount: function (card, api) {
    var self = this;
    card.innerHTML =
      '<div class="text">' +
      '  <p class="eyebrow">Magic Remote</p>' +
      '  <h2>Pointer is <span class="state">…</span></h2>' +
      '  <p class="desc">Checking the current setting.</p>' +
      '</div>' +
      '<button disabled>Please wait</button>';
    this.stateEl = card.querySelector('.state');
    this.descEl = card.querySelector('.desc');
    this.button = card.querySelector('button');
    this.value = null;

    this.button.addEventListener('click', function () {
      if (self.value === null || self.button.disabled) return;
      self.button.disabled = true;
      api.luna('setPointer', { pointer: self.value === 'on' ? 'off' : 'on' })
        .then(api.refresh, api.showError)
        .then(function () {
          self.button.disabled = self.value === null;
          self.button.focus();
        });
    });
  },

  update: function (s) {
    var DESC = {
      off: 'Shaking or moving the remote will not bring up a cursor. Use the arrow keys and OK.',
      on: 'The remote works as a pointer. Shake it or move it to show the cursor.'
    };
    this.value = s.value === 'on' ? 'on' : s.value === 'off' ? 'off' : null;
    if (this.value === null) {
      this.stateEl.textContent = 'unknown';
      this.stateEl.className = 'state';
      this.button.textContent = 'Unavailable';
      this.button.disabled = true;
      return;
    }
    this.stateEl.textContent = this.value;
    // Off is the state this card is for, so it reads green and on reads red.
    this.stateEl.className = 'state ' + (this.value === 'off' ? 'good' : 'bad');
    this.descEl.textContent = DESC[this.value];
    this.button.textContent = this.value === 'on' ? 'Turn pointer off' : 'Turn pointer on';
    this.button.disabled = false;
  },
});
