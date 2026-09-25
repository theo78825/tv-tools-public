// Reboot the TV (service: features/power.js). Asks first, Cancel focused.
TVTools.register({
  id: 'power',

  mount: function (card, api) {
    card.innerHTML =
      '<div class="text">' +
      '  <p class="eyebrow">Power</p>' +
      '  <h2>Reboot TV</h2>' +
      '  <p class="desc">Restarts the TV. The screen goes dark for about a minute.</p>' +
      '</div>' +
      '<button class="danger">Reboot</button>';
    var button = card.querySelector('button');
    var desc = card.querySelector('.desc');

    button.addEventListener('click', function () {
      api.confirm({
        title: 'Reboot the TV?',
        body: 'Anything playing will stop. The TV comes back on its own in about a minute.',
        okLabel: 'Reboot',
      }).then(function (yes) {
        if (!yes) return;
        button.disabled = true;
        button.textContent = 'Rebooting…';
        desc.textContent = 'Rebooting now.';
        api.luna('reboot').catch(function (err) {
          api.showError(err);
          button.disabled = false;
          button.textContent = 'Reboot';
          desc.textContent = 'Restarts the TV. The screen goes dark for about a minute.';
          button.focus();
        });
      });
    });
  },
});
