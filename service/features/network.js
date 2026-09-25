// The TV's current network address, for the header of the TV Tools app.
// Read from LG's connection manager each time, so a DHCP change shows up.

module.exports = {
  name: 'network',

  async status(ctx) {
    const s = await ctx.call('luna://com.webos.service.connectionmanager/getStatus', {});
    const wired = s.wired || {};
    const wifi = s.wifi || {};
    if (wired.state === 'connected' && wired.ipAddress) {
      return { ip: wired.ipAddress, via: 'Ethernet' };
    }
    if (wifi.state === 'connected' && wifi.ipAddress) {
      const mhz = Number(wifi.connectedFrequency) || 0;
      const band = mhz >= 5900 ? '6 GHz' : mhz >= 4900 ? '5 GHz' : mhz ? '2.4 GHz' : '';
      return { ip: wifi.ipAddress, via: 'Wi-Fi', ssid: wifi.ssid || wifi.displayName || '', band };
    }
    return { ip: null, via: 'Not connected' };
  },
};
