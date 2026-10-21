// Self-contained Leaflet page rendered inside a WebView.
//
// Real OpenStreetMap data, no API key and no billing account.
//
// React Native pushes state in with:
//   window.RESQORA.update({ victim, me, responders, showRoute })
// and the page posts { type: 'ready' | 'error' | 'expand' } back out.

const LEAFLET_VERSION = '1.9.4';

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function buildMapHtml({ interactive = false } = {}) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css" />
<style>
  html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; background: #0d1117; }
  .leaflet-container { background: #0d1117; font-family: -apple-system, Roboto, sans-serif; }
  .leaflet-control-attribution {
    background: rgba(10,10,10,0.65) !important;
    color: #6b7280 !important;
    font-size: 9px !important;
  }
  .leaflet-control-attribution a { color: #9ca3af !important; }

  .pin { position: relative; width: 0; height: 0; }
  .pin-core {
    position: absolute; left: -7px; top: -7px;
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.9);
    box-shadow: 0 0 10px rgba(0,0,0,0.6);
  }
  .pin-ring {
    position: absolute; left: -18px; top: -18px;
    width: 36px; height: 36px; border-radius: 50%;
    border: 2px solid currentColor; opacity: 0.6;
    animation: pulse 1.8s ease-out infinite;
  }
  .pin-label {
    position: absolute; left: 12px; top: -9px;
    white-space: nowrap; font-size: 11px; font-weight: 700;
    color: #fff; background: rgba(10,10,10,0.75);
    padding: 2px 6px; border-radius: 5px;
  }
  .victim { color: #ef4444; }
  .victim .pin-core { background: #ef4444; }
  .me { color: #3b82f6; }
  .me .pin-core { background: #3b82f6; }
  .me .pin-ring { animation: none; opacity: 0.35; }
  .responder { color: #22c55e; }
  .responder .pin-core { background: #22c55e; }
  .responder .pin-ring { animation-duration: 2.4s; }

  @keyframes pulse {
    0%   { transform: scale(0.5); opacity: 0.8; }
    100% { transform: scale(1.6); opacity: 0; }
  }

  .dist-label {
    background: rgba(10,10,10,0.8); border: 1px solid rgba(255,255,255,0.15);
    color: #fff; font-size: 11px; font-weight: 700;
    padding: 2px 7px; border-radius: 10px; white-space: nowrap;
  }
  .dist-label::before { display: none; }

  #expand {
    position: absolute; right: 8px; bottom: 8px; z-index: 900;
    width: 34px; height: 34px; border-radius: 8px;
    background: rgba(10,10,10,0.8); border: 1px solid rgba(255,255,255,0.15);
    color: #fff; font-size: 15px; line-height: 32px; text-align: center;
    cursor: pointer; ${interactive ? 'display: none;' : ''}
  }
  #waiting {
    position: absolute; inset: 0; z-index: 800; display: flex;
    align-items: center; justify-content: center;
    color: #52525b; font-size: 12px; font-family: -apple-system, Roboto, sans-serif;
    background: #0d1117; pointer-events: none;
  }
</style>
</head>
<body>
<div id="map"></div>
<div id="waiting">Loading map...</div>
<div id="expand">&#9974;</div>
<script src="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js"
        onerror="window.__mapFailed && window.__mapFailed('leaflet')"></script>
<script>
(function () {
  var INTERACTIVE = ${interactive ? 'true' : 'false'};

  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  window.__mapFailed = function (what) {
    post({ type: 'error', reason: what });
  };

  if (typeof L === 'undefined') {
    window.__mapFailed('leaflet');
    return;
  }

  var map = L.map('map', {
    zoomControl: INTERACTIVE,
    attributionControl: true,
    dragging: INTERACTIVE,
    scrollWheelZoom: INTERACTIVE,
    doubleClickZoom: INTERACTIVE,
    touchZoom: INTERACTIVE,
    boxZoom: false,
    keyboard: false,
    tap: INTERACTIVE,
    zoomSnap: 0.25,
  }).setView([20.5937, 78.9629], 4);

  var attribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  var tiles = L.tileLayer('${OSM_TILES}', {
    maxZoom: 19, attribution: attribution,
  }).addTo(map);

  var layers = { victim: null, me: null, route: null, responders: {} };
  var userMoved = false;
  var hasFitted = false;

  map.on('dragstart zoomstart', function (e) {
    if (INTERACTIVE && e.type === 'dragstart') userMoved = true;
  });

  function icon(kind, label, showRing) {
    return L.divIcon({
      className: '',
      iconSize: [0, 0],
      html:
        '<div class="pin ' + kind + '">' +
          (showRing ? '<div class="pin-ring"></div>' : '') +
          '<div class="pin-core"></div>' +
          (label ? '<div class="pin-label">' + label + '</div>' : '') +
        '</div>',
    });
  }

  function valid(p) {
    return p && typeof p.lat === 'number' && typeof p.lon === 'number' &&
      isFinite(p.lat) && isFinite(p.lon) && (p.lat !== 0 || p.lon !== 0);
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function place(existing, point, kind, label, showRing) {
    if (!valid(point)) {
      if (existing) map.removeLayer(existing);
      return null;
    }
    var latlng = [point.lat, point.lon];
    if (existing) {
      existing.setLatLng(latlng);
      existing.setIcon(icon(kind, escapeHtml(label), showRing));
      return existing;
    }
    return L.marker(latlng, {
      icon: icon(kind, escapeHtml(label), showRing),
      interactive: false,
      keyboard: false,
    }).addTo(map);
  }

  function km(a, b) {
    var R = 6371;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLon = (b.lon - a.lon) * Math.PI / 180;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  function format(distance) {
    return distance < 1
      ? Math.round(distance * 1000) + ' m'
      : distance.toFixed(2) + ' km';
  }

  window.RESQORA = {
    update: function (state) {
      state = state || {};
      var points = [];

      layers.victim = place(layers.victim, state.victim, 'victim',
        state.victim && state.victim.label, true);
      if (valid(state.victim)) points.push([state.victim.lat, state.victim.lon]);

      layers.me = place(layers.me, state.me, 'me', state.me && state.me.label, true);
      if (valid(state.me)) points.push([state.me.lat, state.me.lon]);

      var seen = {};
      (state.responders || []).forEach(function (r) {
        if (!valid(r)) return;
        var key = String(r.id);
        seen[key] = true;
        layers.responders[key] = place(layers.responders[key], r, 'responder', r.label, true);
        points.push([r.lat, r.lon]);
      });
      Object.keys(layers.responders).forEach(function (key) {
        if (!seen[key] && layers.responders[key]) {
          map.removeLayer(layers.responders[key]);
          delete layers.responders[key];
        }
      });

      // Straight line + live distance between the two ends of the emergency.
      if (layers.route) { map.removeLayer(layers.route); layers.route = null; }
      if (state.showRoute && valid(state.victim) && valid(state.me)) {
        layers.route = L.polyline(
          [[state.me.lat, state.me.lon], [state.victim.lat, state.victim.lon]],
          { color: '#22c55e', weight: 3, opacity: 0.85, dashArray: '7 7' }
        ).addTo(map);
        layers.route.bindTooltip(format(km(state.me, state.victim)), {
          permanent: true, direction: 'center', className: 'dist-label',
        }).openTooltip();
      }

      var waiting = document.getElementById('waiting');
      if (waiting) waiting.style.display = points.length ? 'none' : 'flex';
      if (!points.length) return;

      if (!hasFitted || !userMoved) {
        if (points.length === 1) {
          map.setView(points[0], hasFitted ? map.getZoom() : 16, { animate: hasFitted });
        } else {
          map.fitBounds(L.latLngBounds(points), {
            padding: [40, 40], maxZoom: 17, animate: hasFitted,
          });
        }
        hasFitted = true;
      }
    },
    recenter: function () {
      userMoved = false;
      if (window.__lastState) window.RESQORA.update(window.__lastState);
    },
  };

  var original = window.RESQORA.update;
  window.RESQORA.update = function (state) {
    window.__lastState = state;
    original(state);
  };

  document.getElementById('expand').addEventListener('click', function () {
    post({ type: 'expand' });
  });

  setTimeout(function () { map.invalidateSize(); }, 150);
  post({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
