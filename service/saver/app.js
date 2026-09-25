// Bouncing-ball screensaver: a white ball that falls and bounces under gravity,
// with a fading trail. This page is bind-mounted over LG's videoads app (as its
// index.html and app.js; see screensaver-apply.sh), which tvpowerd launches as
// the screensaver while lgchannels.isVideoScreenSaverEnabled is on. So LG still
// decides when the screensaver starts (its idle timer, never over playing video),
// the power state reads "Screen Saver", and LG closes this page itself when the
// screen wakes by any route (a button, the LG ThinQ app, a smart-home call).
//
// Screen protection, the same things LG's screensaver does:
// - nothing stands still: the ball never stops, and every floor bounce changes
//   its height and speed a little, so it never retraces the same path;
// - every minute or so the screen goes fully black for a few seconds, then a new
//   scene starts with a new ball size, drop point and direction;
// - it dims slowly over the first hour.
//
// A key press is ours (the screensaver has focus), and turning it into a wake
// is the screensaver app's job: nothing else in LG does it. We run with
// videoads' permissions, so we call tvpower turnOnScreen directly.
(function () {
  var W = 1920;
  var H = 1080;
  // Calm but real gravity: a drop from the top takes ~1.6 s, and it drifts
  // sideways at SIDE px/s, crossing the screen in 10-17 s.
  var G = 900;                   // gravity, px/s²
  var SIDE = [110, 190];
  var FLOOR_BOUNCE = 0.8;        // speed kept on hitting the floor,
  var WALL_BOUNCE = 0.95;        // and the walls and ceiling
  var LOW = 0.3 * H;             // a bounce lower than this gets a fresh kick up
  var TRAIL = 0.9;               // seconds of trail
  var STEP = 0.004;              // physics step, s; the trail gets a point per step
  var SCENE_MIN = 45000;         // a scene lasts 45-75 s,
  var SCENE_MAX = 75000;
  var FADE = 1200;               // then fades out (matches the CSS transition),
  var BLACK = 4000;              // and the screen stays black this long
  var DIM_AFTER = 60 * 60 * 1000; // brightness eases from 100% to DIM_TO over this
  var DIM_TO = 0.6;

  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var started = Date.now();
  var r, x, y, vx, vy, sprite, squash = 0;
  var trail = [];
  var moving = false;
  var clock = 0;   // simulation seconds
  var last = 0;
  var frames = 0;   // for the frame-rate line in the TV's log

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  // Upward speed that carries the ball `h` px high.
  function launchSpeed(h) { return -Math.sqrt(2 * G * h); }

  // The ball, drawn once per scene: a soft white sphere with a faint glow.
  function makeSprite() {
    var pad = Math.round(r * 0.6);
    var c = document.createElement('canvas');
    c.width = c.height = 2 * (r + pad);
    var g = c.getContext('2d');
    var mid = r + pad;
    var glow = g.createRadialGradient(mid, mid, r * 0.9, mid, mid, r + pad);
    glow.addColorStop(0, 'rgba(255,255,255,0.16)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, c.width, c.height);
    var body = g.createRadialGradient(mid - r * 0.35, mid - r * 0.4, r * 0.1, mid, mid, r);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.55, '#f2f2f2');
    body.addColorStop(1, '#b9b9bd');
    g.fillStyle = body;
    g.beginPath();
    g.arc(mid, mid, r, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  function newScene() {
    r = Math.round(rand(11, 15));
    sprite = makeSprite();
    x = rand(r, W - r);
    y = rand(r, H * 0.45);                       // dropped from somewhere up high
    vx = (Math.random() < 0.5 ? -1 : 1) * rand(SIDE[0], SIDE[1]);
    vy = rand(-150, 100);
    squash = 0;
    trail = [];
    moving = true;
    requestAnimationFrame(function () { canvas.classList.add('shown'); }); // fade in
    setTimeout(endScene, rand(SCENE_MIN, SCENE_MAX));
  }

  function endScene() {
    canvas.classList.remove('shown');
    setTimeout(function () { moving = false; ctx.clearRect(0, 0, W, H); }, FADE);
    setTimeout(newScene, FADE + BLACK);
  }

  function step(dt) {
    vy += G * dt;
    x += vx * dt;
    y += vy * dt;
    if (x < r || x > W - r) {
      x = x < r ? r : W - r;
      vx = -vx * WALL_BOUNCE;
    }
    if (y < r) {
      y = r;
      vy = -vy * WALL_BOUNCE;
    }
    if (y > H - r) {
      y = H - r;
      squash = Math.min(1, vy / 1400);
      vy = -vy * FLOOR_BOUNCE;
      // Too low to look alive: kick it back up, to a new height each time, and
      // freshen its sideways speed so the path keeps changing.
      if (vy * vy / (2 * G) < LOW) {
        vy = launchSpeed(rand(0.45, 0.92) * H);
        vx = (Math.random() < 0.25 ? -1 : 1) * (vx < 0 ? -1 : 1) * rand(SIDE[0], SIDE[1]);
      }
    }
    squash = Math.max(0, squash - dt * 7);
  }

  var BANDS = 36;
  var TRAIL_PEAK = 128; // grey level of the trail's newest end (0-255)

  // The trail in solid greys, not see-through white: on a pure black
  // background a grey looks the same as faded white, and solid strokes can't
  // brighten where they overlap. So consecutive points are joined into one
  // polyline per brightness band, drawn oldest first with round ends; each band
  // covers the join with the one before, leaving no seams and no beads (both
  // showed with see-through strokes).
  function strokeTrail() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var i = 0;
    while (i < trail.length - 1) {
      var band = Math.floor(Math.max(0, 1 - (clock - trail[i].t) / TRAIL) * BANDS);
      ctx.beginPath();
      ctx.moveTo(trail[i].x, trail[i].y);
      var j = i + 1;
      while (j < trail.length) {
        ctx.lineTo(trail[j].x, trail[j].y);
        if (Math.floor(Math.max(0, 1 - (clock - trail[j].t) / TRAIL) * BANDS) !== band) break;
        j++;
      }
      var f = (band + 0.5) / BANDS;
      var g = Math.round(TRAIL_PEAK * f * f);
      ctx.strokeStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
      ctx.lineWidth = Math.max(1, r * 0.8 * f);
      ctx.stroke();
      if (j >= trail.length) break;
      i = j;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    strokeTrail(); // older points fainter and thinner
    // Ball, squashed for a moment where it hits the floor (bottom stays put).
    var half = sprite.width / 2;
    var sx = 1 + 0.18 * squash;
    var sy = 1 - 0.22 * squash;
    ctx.save();
    ctx.translate(x, y + r * (1 - sy));
    ctx.scale(sx, sy);
    ctx.drawImage(sprite, -half, -half);
    ctx.restore();
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - (last || now)) / 1000); // no jump after a stall
    last = now;
    if (moving) {
      // Small fixed steps keep the bounces exact at any frame rate, and give
      // the trail a point every few px: drawn from one point per frame, a fast
      // trail was a few long straight pieces with visible steps in width and
      // brightness.
      var n = Math.max(1, Math.ceil(dt / STEP));
      for (var k = 0; k < n; k++) {
        step(dt / n);
        clock += dt / n;
        trail.push({ x: x, y: y, t: clock });
      }
      while (trail.length && clock - trail[0].t > TRAIL) trail.shift();
      frames++;
      draw();
    }
    var dim = 1 - (1 - DIM_TO) * Math.min(1, (Date.now() - started) / DIM_AFTER);
    document.body.style.opacity = dim.toFixed(3);
    requestAnimationFrame(frame);
  }

  var bridges = []; // keep service bridges alive until they answer

  function wake() {
    var Bridge = window.WebOSServiceBridge || window.PalmServiceBridge;
    if (Bridge) {
      var bridge = new Bridge();
      bridges.push(bridge);
      bridge.onservicecallback = function () { /* tvpowerd closes us */ };
      bridge.call('luna://com.webos.service.tvpower/power/turnOnScreen', '{}');
    }
    // If that didn't take, closing still wakes the TV: tvpowerd goes back to
    // Active when its screensaver app disappears.
    setTimeout(function () { window.close(); }, 1500);
  }

  var waking = false;
  document.addEventListener('keydown', function (e) {
    e.preventDefault();
    if (waking) return;
    waking = true;
    wake();
  });

  // Once a minute, the frame rate into the TV's log (grep BALLSAVER in
  // /var/log/dbg-log), to check it runs smoothly on the TV itself.
  setInterval(function () {
    if (window.webOSSystem && webOSSystem.PmLogString) {
      webOSSystem.PmLogString(6, 'BALLSAVER', '{}', 'fps ' + (frames / 60).toFixed(1) + ' trail points ' + trail.length);
    }
    frames = 0;
  }, 60000);

  document.addEventListener('webOSRelaunch', function () { /* already showing */ });

  newScene();
  requestAnimationFrame(frame);
})();
