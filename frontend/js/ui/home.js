// Home: three ways to start (Free Ride, Routes, Workouts) and the
// Leaderboard. Routes and Workouts open a picker (ui/ride-picker.js);
// every start goes through the trainer check in app.js.
export function initHome({ onFreeRide, onPick }) {
  document.getElementById('start-free').addEventListener('click', onFreeRide);
  document.getElementById('start-routes').addEventListener('click', () => onPick('routes'));
  document.getElementById('start-workouts').addEventListener('click', () => onPick('workouts'));
}
