// Screensaver: bouncing ball or LG's, and how long the screensaver may run
// before the TV turns itself off (service: features/screensaver.js).
TVTools.register({
  id: 'screensaver',

  mount: function (card, api) {
    var self = this;
    card.innerHTML =
      '<div class="text">' +
      '  <p class="eyebrow">Screensaver</p>' +
      '  <h2>Showing <span class="state">…</span></h2>' +
      '  <p class="desc">Checking.</p>' +
      '</div>' +
      '<div class="toggles">' +
      '  <button class="switch">Please wait</button>' +
      '  <button class="hours">Please wait</button>' +
      '  <button class="preview">Show it now</button>' +
      '</div>';
    this.api = api;
    this.stateEl = card.querySelector('.state');
    this.desc = card.querySelector('.desc');
    this.switchBtn = card.querySelector('.switch');
    this.hoursBtn = card.querySelector('.hours');
    this.previewBtn = card.querySelector('.preview');
    this.s = null;
    this.busy = false;

    // Buttons stay enabled while busy, so focus stays put.
    function act(btn, label, method, params) {
      if (self.busy || !self.s) return;
      self.busy = true;
      btn.textContent = label;
      api.luna(method, params)
        .then(function () { api.showError(''); }, api.showError)
        .then(function () { self.busy = false; return api.refresh(); });
    }

    this.switchBtn.addEventListener('click', function () {
      act(self.switchBtn, 'Switching…', 'setScreensaver', { enabled: !self.s.enabled });
    });

    // Steps through 1, 2, 3, 4, 6, 8 hours, then never.
    this.hoursBtn.addEventListener('click', function () {
      if (!self.s) return;
      var list = self.s.hourChoices.concat([0]);
      var next = list[(list.indexOf(self.s.offHours) + 1) % list.length];
      act(self.hoursBtn, 'Saving…', 'setScreensaverOffHours', { hours: next });
    });

    this.previewBtn.addEventListener('click', function () {
      act(self.previewBtn, 'Starting…', 'previewScreensaver', {});
      setTimeout(function () { self.previewBtn.textContent = 'Show it now'; }, 3000);
    });
  },

  update: function (s) {
    this.s = s;
    var fmt = this.api.formatTime;
    var notApplied = s.enabled && !s.applied;
    this.stateEl.textContent = notApplied ? 'LG’s (ball not set up)' : s.enabled ? 'bouncing ball' : 'LG’s';
    this.stateEl.className = 'state ' + (notApplied || (s.needed && !s.running) ? 'warn' : s.enabled ? 'on' : 'off');
    this.switchBtn.textContent = s.enabled ? 'Use LG’s screensaver' : 'Use bouncing ball';
    this.hoursBtn.textContent = s.offHours ? 'TV off after ' + s.offHours + (s.offHours === 1 ? ' hour' : ' hours') : 'Never turn TV off';

    var text = s.enabled
      ? 'A white ball bounces around the screen with a fading trail, going black every minute or so before a new scene, like LG’s does to protect the screen. Any button wakes the TV.'
      : 'LG’s own screensaver (the clock and “press any button”).';
    text += s.offHours
      ? ' After ' + s.offHours + (s.offHours === 1 ? ' hour' : ' hours') + ' of screensaver the TV turns itself off.'
      : ' The TV never turns itself off from the screensaver.';
    if (s.since) text += ' Screensaver on since ' + fmt(s.since) + '.';
    if (s.lastOff) text += ' Last turned the TV off ' + fmt(s.lastOff.at) + '.';
    this.desc.textContent = text;
  },
});
