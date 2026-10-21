// The public tracking page: a live map of one emergency, openable by anyone
// holding the link. No app, no account, works in any browser.
//
// It reads /t/:token/data every few seconds rather than holding a socket, so
// it survives a flaky mobile connection and a phone that locks its screen.
// All values are written with textContent — never interpolated into HTML.

const LEAFLET = '1.9.4';

function escapeAttr(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, '');
}

function buildTrackPage(token) {
  const safeToken = escapeAttr(token);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>RESQORA — live location</title>
<meta name="robots" content="noindex, nofollow" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET}/dist/leaflet.css" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #09090B; color: #FAFAFA;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; min-height: 100dvh;
  }
  header {
    padding: 14px 18px; display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid rgba(255,255,255,0.09);
  }
  .dot {
    width: 10px; height: 10px; border-radius: 50%; background: #EF4444;
    animation: pulse 1.6s ease-out infinite; flex: none;
  }
  .dot.ended { background: #22C55E; animation: none; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.7);} 100% { box-shadow: 0 0 0 12px rgba(239,68,68,0);} }
  h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .sub { font-size: 12px; color: #A1A1AA; margin-top: 2px; }
  #map { flex: 1; min-height: 45dvh; background: #0D1117; }
  .panel { padding: 16px 18px 24px; display: grid; gap: 12px; }
  .card {
    background: #131316; border: 1px solid rgba(255,255,255,0.09);
    border-radius: 14px; padding: 14px;
  }
  .label {
    font-size: 10px; letter-spacing: 1.1px; text-transform: uppercase;
    color: #71717A; font-weight: 600; margin-bottom: 6px;
  }
  .message { font-size: 15px; line-height: 1.5; }
  .coords { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; color: #A1A1AA; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  .chip {
    background: #1C1C21; border-radius: 999px; padding: 5px 11px;
    font-size: 12px; color: #A1A1AA;
  }
  img.photo { width: 100%; border-radius: 10px; display: block; margin-top: 10px; }
  a.action {
    display: block; text-align: center; text-decoration: none;
    background: #EF4444; color: #fff; font-weight: 600; font-size: 15px;
    padding: 15px; border-radius: 14px;
  }
  .ended-banner {
    background: rgba(34,197,94,0.13); border: 1px solid rgba(34,197,94,0.3);
    color: #22C55E; border-radius: 14px; padding: 14px; font-size: 14px;
  }
  .hidden { display: none !important; }
  footer { padding: 0 18px 20px; font-size: 11px; color: #52525B; text-align: center; }
</style>
</head>
<body>
  <header>
    <span class="dot" id="dot"></span>
    <div>
      <h1 id="title">Loading…</h1>
      <div class="sub" id="subtitle">Fetching live location</div>
    </div>
  </header>

  <div id="map"></div>

  <div class="panel">
    <div class="ended-banner hidden" id="ended"></div>

    <div class="card">
      <div class="label">Their message</div>
      <div class="message" id="message">—</div>
      <img class="photo hidden" id="photo" alt="Photo shared from the scene" />
    </div>

    <div class="card">
      <div class="label">Location</div>
      <div class="coords" id="coords">—</div>
      <div class="row" style="margin-top:10px">
        <span class="chip" id="updated">—</span>
        <span class="chip" id="helpers">—</span>
      </div>
    </div>

    <a class="action" id="directions" href="#" target="_blank" rel="noopener">Open in maps</a>
  </div>

  <footer>Shared from RESQORA. This link stops updating when the emergency ends.</footer>

<script src="https://unpkg.com/leaflet@${LEAFLET}/dist/leaflet.js"></script>
<script>
(function () {
  var TOKEN = ${JSON.stringify(safeToken)};
  var map = null;
  var marker = null;
  var stopped = false;

  function el(id) { return document.getElementById(id); }

  function ensureMap(lat, lon) {
    if (!map) {
      map = L.map('map', { zoomControl: true, attributionControl: true }).setView([lat, lon], 16);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, subdomains: 'abcd',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO'
      }).addTo(map);
      marker = L.circleMarker([lat, lon], {
        radius: 10, color: '#fff', weight: 2, fillColor: '#EF4444', fillOpacity: 1
      }).addTo(map);
    } else {
      marker.setLatLng([lat, lon]);
      map.panTo([lat, lon], { animate: true });
    }
  }

  function ago(iso) {
    if (!iso) return 'just now';
    var seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return seconds + 's ago';
    var minutes = Math.round(seconds / 60);
    return minutes < 60 ? minutes + ' min ago' : Math.round(minutes / 60) + 'h ago';
  }

  function render(data) {
    var live = data.status === 'active';

    el('title').textContent = live
      ? data.victimName + ' needs help'
      : data.victimName + ' is safe now';
    el('subtitle').textContent = live
      ? 'Live location, updating automatically'
      : 'This emergency has ended';
    el('dot').className = live ? 'dot' : 'dot ended';
    el('message').textContent = data.message || '';

    if (data.imageUrl) {
      el('photo').src = data.imageUrl;
      el('photo').classList.remove('hidden');
    }

    if (typeof data.lat === 'number') {
      el('coords').textContent = data.lat.toFixed(5) + ', ' + data.lon.toFixed(5);
      el('directions').href =
        'https://www.openstreetmap.org/?mlat=' + data.lat + '&mlon=' + data.lon + '#map=17/' + data.lat + '/' + data.lon;
      ensureMap(data.lat, data.lon);
    }

    el('updated').textContent = 'Updated ' + ago(data.updatedAt);
    el('helpers').textContent = data.respondersCount === 1
      ? '1 person responding'
      : data.respondersCount + ' people responding';

    if (!live) {
      stopped = true;
      el('ended').textContent = 'The emergency is over. This page has stopped updating.';
      el('ended').classList.remove('hidden');
      el('directions').classList.add('hidden');
    }
  }

  function poll() {
    fetch('/t/' + TOKEN + '/data', { headers: { 'ngrok-skip-browser-warning': 'true' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(render)
      .catch(function () {
        el('subtitle').textContent = 'Connection lost — retrying';
      })
      .finally(function () {
        if (!stopped) setTimeout(poll, 5000);
      });
  }

  poll();
})();
</script>
</body>
</html>`;
}

module.exports = { buildTrackPage };
