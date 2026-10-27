/* ===== SVM Leaflet adapter (local preview only; not used on the website) ===== */
function SVMLeafletAdapter(mapEl) {
  'use strict';
  var map = L.map(mapEl, { preferCanvas: false }).setView([37.7105, -121.9405], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  function ll(p) { return [p.lat, p.lng]; }
  var style = {
    start: { radius: 8, color: '#fff', weight: 2, fillColor: '#00c853', fillOpacity: 1 },
    end: { radius: 6, color: '#fff', weight: 2, fillColor: '#d50000', fillOpacity: 1 },
    rej: { radius: 3.5, color: '#424242', weight: 1, fillColor: '#9e9e9e', fillOpacity: 0.9 },
    mark: { radius: 8, color: '#fff', weight: 2, fillColor: '#ff1744', fillOpacity: 1 }
  };
  return {
    polyline: function (pts, o) {
      return L.polyline(pts.map(ll), { color: o.color, weight: o.weight, opacity: o.opacity, dashArray: o.dashed ? '2 6' : null }).addTo(map);
    },
    polygon: function (ring, o) {
      return L.polygon(ring.map(ll), { color: o.color, fillColor: o.color, fillOpacity: o.fillOpacity, opacity: o.strokeOpacity, weight: 1, interactive: false }).addTo(map);
    },
    marker: function (p, o) {
      var m = L.circleMarker(ll(p), style[o.kind] || style.mark).addTo(map);
      if (o.label) m.bindTooltip(o.label, { permanent: true, direction: 'center', className: 'svm-lbl' });
      return m;
    },
    onClick: function (h, fn) { h.on('click', function (e) { fn({ lat: e.latlng.lat, lng: e.latlng.lng }); }); },
    openInfo: function (p, html) { L.popup().setLatLng(ll(p)).setContent(html).openOn(map); },
    remove: function (h) { map.removeLayer(h); },
    fitBounds: function (b) { map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [40, 40] }); }
  };
}
/* ===== SVM Leaflet adapter END ===== */
