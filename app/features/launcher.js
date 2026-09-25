// Home screen (service: features/launcher.js): which home screen the Home
// button opens, LG's or ours (home.html, this app's other screen).
TVTools.register({
  id: 'launcher',

  mount: function (card, api) {
    var self = this;
    card.innerHTML =
      '<div class="text">' +
      '  <p class="eyebrow">Home screen</p>' +
      '  <h2>Home button opens <span class="state">…</span></h2>' +
      '  <p class="desc">Checking.</p>' +
      '</div>' +
      '<div class="toggles">' +
      '  <button class="switch">Please wait</button>' +
      '  <button class="open">Open ours now</button>' +
      '</div>';
    this.stateEl = card.querySelector('.state');
    this.desc = card.querySelector('.desc');
    this.button = card.querySelector('.switch');
    this.on = null;
    this.busy = false;

    this.button.addEventListener('click', function () {
      if (self.busy || self.on === null) return;
      self.busy = true; // button stays enabled so focus stays put
      self.button.textContent = 'Switching…';
      api.luna('setRedirect', { on: !self.on })
        .then(function () { api.showError(''); }, api.showError)
        .then(function () { self.busy = false; return api.refresh(); });
    });
    card.querySelector('.open').addEventListener('click', function () { TVView.go('home'); });
  },

  update: function (s) {
    this.on = !!s.redirect;
    this.stateEl.textContent = this.on ? 'ours' : 'LG’s';
    this.stateEl.className = 'state ' + (this.on ? 'on' : '');
    if (s.tripped) {
      this.desc.textContent = 'Switched itself off (' + s.tripped + '). LG’s is back. Turn it on again to retry.';
    } else if (this.on) {
      this.desc.textContent = 'When LG’s home screen appears, ours opens over it: a clock, a big row of favourites and all your apps. Hold OK on an app to move, rename or hide it. Its LG Home button gets you back to LG’s.';
    } else {
      this.desc.textContent = 'Ours is a simpler home screen: a clock, a big row of favourites and all your apps, with no ads or rows of suggestions.';
    }
    this.button.textContent = this.on ? 'Use LG’s' : 'Use ours';
  },
});
