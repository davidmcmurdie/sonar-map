/* ===== SVM Google Maps adapter ===== */
function SVMGoogleAdapter(mapEl) {
  'use strict';
  var g = google.maps;
  var map = new g.Map(mapEl, {
    center: { lat: 37.7105, lng: -121.9405 }, zoom: 16,
    mapTypeId: 'hybrid',            // satellite imagery with labels
    mapTypeControl: true, streetViewControl: false, fullscreenControl: true,
    tilt: 0, gestureHandling: 'greedy' // one-finger pan on phones (the map sits in its own box)
  });
  var info = new g.InfoWindow();
  function ll(p) { return { lat: p.lat, lng: p.lng }; }
  function icon(o) {
    if (o.kind === 'start') return { path: g.SymbolPath.CIRCLE, scale: 8, fillColor: '#00c853', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };
    if (o.kind === 'end') return { path: g.SymbolPath.CIRCLE, scale: 6, fillColor: '#d50000', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };
    if (o.kind === 'rej') return { path: g.SymbolPath.CIRCLE, scale: 3.5, fillColor: '#9e9e9e', fillOpacity: 0.9, strokeColor: '#424242', strokeWeight: 1 };
    // mark: diamond
    return { path: 'M 0,-10 8,0 0,10 -8,0 z', scale: 1.2, fillColor: '#ff1744', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };
  }
  return {
    polyline: function (pts, o) {
      var opt = { map: map, path: pts.map(ll), strokeColor: o.color, strokeOpacity: o.dashed ? 0 : o.opacity, strokeWeight: o.weight, clickable: true };
      if (o.dashed) opt.icons = [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: o.opacity, strokeColor: o.color, scale: o.weight }, offset: '0', repeat: (o.weight * 4) + 'px' }];
      return new g.Polyline(opt);
    },
    polygon: function (ring, o) {
      return new g.Polygon({ map: map, paths: ring.map(ll), fillColor: o.color, fillOpacity: o.fillOpacity,
        strokeColor: o.color, strokeOpacity: o.strokeOpacity, strokeWeight: 1, clickable: false });
    },
    marker: function (p, o) {
      // google.maps.Marker is deprecated in favour of AdvancedMarkerElement, which needs a Map ID;
      // Marker still works and keeps setup to a single API key.
      return new g.Marker({ map: map, position: ll(p), icon: icon(o), zIndex: o.kind === 'mark' ? 30 : o.kind === 'rej' ? 5 : 20,
        label: o.label && o.kind === 'mark' ? { text: o.label, color: '#fff', fontSize: '11px', fontWeight: 'bold' } :
               o.label && o.kind === 'start' ? { text: o.label, color: '#fff', fontSize: '10px', fontWeight: 'bold' } : null });
    },
    onClick: function (h, fn) { h.addListener('click', function (e) { fn(e && e.latLng ? { lat: e.latLng.lat(), lng: e.latLng.lng() } : null); }); },
    openInfo: function (p, html) { info.setContent(html); info.setPosition(ll(p)); info.open({ map: map }); },
    remove: function (h) { h.setMap(null); },
    fitBounds: function (b) {
      map.fitBounds({ south: b.south, west: b.west, north: b.north, east: b.east }, 40);
    }
  };
}
/* ===== SVM Google Maps adapter END ===== */
