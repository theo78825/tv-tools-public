// Health checks (service: features/health.js). Read-only: shows whether root,
// the update block, the boot scripts and each tool are the way they should be.
TVTools.register({
  id: 'health',

  mount: function (card, api) {
    var self = this;
    card.classList.add('health');
    card.innerHTML =
      '<div class="text">' +
      '  <p class="eyebrow">Health</p>' +
      '  <h2 class="state">Checking…</h2>' +
      '  <p class="desc"></p>' +
      '</div>' +
      '<button>Check again</button>' +
      '<ul class="checks"></ul>';
    this.api = api;
    this.summary = card.querySelector('h2');
    this.desc = card.querySelector('.desc');
    this.list = card.querySelector('.checks');
    this.button = card.querySelector('button');
    this.busy = false;

    this.button.addEventListener('click', function () {
      if (self.busy) return;
      self.busy = true; // button stays enabled so focus stays put
      self.button.textContent = 'Checking…';
      api.refresh().then(function () {
        self.busy = false;
        self.button.textContent = 'Check again';
      });
    });
  },

  update: function (s) {
    var self = this;
    var checks = s.checks || [];
    if (!checks.length) return;

    var bad = checks.filter(function (c) { return c.level === 'bad'; }).length;
    var warn = checks.filter(function (c) { return c.level === 'warn'; }).length;
    var problems = bad + warn;
    this.summary.textContent = problems ? problems + (problems === 1 ? ' problem' : ' problems') : 'All good';
    this.summary.className = 'state ' + (bad ? 'off' : warn ? 'warn' : 'on');
    var desc = 'Checked at ' + this.api.formatTime(s.checkedAt) + '.';
    if (s.bootedAt) {
      var hours = Math.floor((s.checkedAt - s.bootedAt) / 3600000);
      var up = hours < 1 ? 'under an hour' : hours < 48 ? hours + ' h' : Math.floor(hours / 24) + ' days';
      desc += ' Last restart ' + this.api.formatTime(s.bootedAt) + ', up ' + up + '.';
    }
    this.desc.textContent = desc;

    this.list.innerHTML = '';
    checks.forEach(function (c) {
      var li = document.createElement('li');
      li.dataset.level = c.level;
      li.innerHTML = '<span class="dot"></span><span class="label"></span><span class="detail"></span>';
      li.querySelector('.label').textContent = c.label;
      li.querySelector('.detail').textContent = c.time
        ? c.detail.replace('{time}', self.api.formatTime(c.time))
        : c.detail;
      self.list.appendChild(li);
    });
  },
});
