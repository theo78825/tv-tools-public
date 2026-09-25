// Reboot the TV. Same approach as Homebrew Channel's own reboot: run
// /sbin/reboot as root. The delay lets the Luna reply reach the app first.

const { execFile } = require('child_process');

module.exports = {
  name: 'power',

  methods: {
    async reboot(payload, ctx) {
      ctx.requireRoot();
      setTimeout(() => {
        execFile('/sbin/reboot', (err) => {
          if (err) console.error('reboot failed:', err.message);
        });
      }, 1000);
      return { rebooting: true };
    },
  },
};
