// One app, two screens: home.html (the home screen) and index.html (the TV
// Tools cards). The Home button launches us with {"view":"home"}; any other
// launch means the cards. A relaunch that asks for the other screen switches
// page. Loaded first by both pages, in <head>, so a launch never flashes the
// wrong one.
(function () {
  var APP_ID = 'io.github.theo78825.tvtools';
  var sys = window.webOSSystem || window.PalmSystem;
  var here = /\/home\.html$/.test(location.pathname) ? 'home' : 'tools';
  // The cards opened from our home screen: Back goes back to it.
  var fromHome = /[?&]from=home\b/.test(location.search);

  function wanted(params) {
    if (typeof params === 'string') {
      try { params = JSON.parse(params); } catch (e) { params = null; }
    }
    return params && params.view === 'home' ? 'home' : 'tools';
  }

  function go(view) {
    location.replace(view === 'home' ? 'home.html' : 'index.html?from=home');
  }

  // A fresh launch lands on the screen it asked for. (The cards opened from the
  // home screen still carry the home launch params, so they stay.)
  if (here === 'tools' && !fromHome && wanted(sys && sys.launchParams) === 'home') go('home');

  window.TVView = {
    appId: APP_ID,
    here: here,
    fromHome: fromHome,
    go: go,
    // For webOSRelaunch: switches page if the relaunch asks for the other
    // screen, and says whether it did.
    relaunch: function (e) {
      var v = wanted(e && e.detail != null ? e.detail : sys && sys.launchParams);
      if (v === here) return false;
      go(v);
      return true;
    },
  };
})();
