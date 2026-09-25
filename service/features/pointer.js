// Magic Remote pointer on/off.
//
// Flips the hidden `general.remotePointer` system setting that lginput2 obeys:
// "off" stops the remote from ever producing a cursor (shaking included) and
// turns OK into a plain Enter key. The choice is saved as state `pointer` and
// re-applied at boot by boot.d/pointer.sh.

const SETTINGS = 'luna://com.webos.settingsservice';

async function get(ctx) {
  const p = await ctx.call(`${SETTINGS}/getSystemSettings`, {
    category: 'general',
    keys: ['remotePointer'],
  });
  return p.settings && p.settings.remotePointer;
}

module.exports = {
  name: 'pointer',

  async status(ctx) {
    return { value: await get(ctx), saved: ctx.readState('pointer') };
  },

  methods: {
    async setPointer(payload, ctx) {
      const pointer = payload.pointer;
      if (pointer !== 'on' && pointer !== 'off') {
        throw new Error('"pointer" must be "on" or "off"');
      }
      ctx.requireRoot();
      await ctx.rememberOriginal('general', 'remotePointer');
      await ctx.call(`${SETTINGS}/setSystemSettings`, {
        category: 'general',
        settings: { remotePointer: pointer },
      });
      ctx.writeState('pointer', pointer);
      return { pointer: await get(ctx) };
    },
  },
};
