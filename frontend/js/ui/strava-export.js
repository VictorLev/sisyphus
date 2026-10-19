// Settings → Strava: when on, each ride's page offers its .tcx file and a
// link to Strava's upload page. Nothing goes to Strava from here; the rider
// uploads the file themselves (Strava's API needs a paid subscription).

let enabled = false;

export function setStravaExport(on) {
  enabled = Boolean(on);
}

export function showRideExport(el, sessionId) {
  el.hidden = !enabled;
  if (!enabled) return;
  el.querySelector('#detail-tcx').href = `/api/sessions/${sessionId}/tcx`;
}

