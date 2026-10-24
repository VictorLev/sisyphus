import { getMe, login, logout, changePassword } from '../api/client.js';
import { t } from '../i18n.js';

// The login screen is a modal over the app rather than a page of its own.
// Any 401 opens it where the rider is, so nothing in memory is lost by
// navigating; once they log in the page reloads clean as that user, and any
// ride parked by a failed save is retried on that load.
function initLoginDialog() {
  const dialog = document.getElementById('login-dialog');
  const form = document.getElementById('login-form');
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const submitBtn = document.getElementById('login-submit');
  const statusEl = document.getElementById('login-status');

  // There is nothing behind it to go back to.
  dialog.addEventListener('cancel', (event) => event.preventDefault());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitBtn.disabled = true;
    statusEl.textContent = '';
    try {
      await login(usernameInput.value.trim(), passwordInput.value);
      window.location.reload();
    } catch (err) {
      statusEl.textContent = err.message;
      passwordInput.value = '';
      passwordInput.focus();
      submitBtn.disabled = false;
    }
  });

  function open() {
    if (dialog.open) return;
    dialog.showModal();
    usernameInput.focus();
  }

  window.addEventListener('sisyphus:unauthorized', open);
  return { open };
}

// Resolves to the logged-in user. When nobody is logged in it opens the
// login screen and never resolves: a successful login reloads the page, so
// none of the app's data loading runs until there is someone to load for.
// If the server cannot be reached at all it resolves to null and the app
// starts as the offline shell, as it always has.
export async function requireLogin() {
  const dialog = initLoginDialog();
  let user;
  try {
    user = await getMe();
  } catch {
    return null;
  }
  if (user) return user;
  dialog.open();
  return new Promise(() => {});
}

// A session can end while the app sits open: it expired, the rider logged
// out elsewhere, or changed their password (which ends the others). Without
// a check, the app only finds out at its next call to the server, and the
// screen keeps showing their data until then. So the session is checked
// every minute and whenever the rider comes back to the tab; once it's gone,
// the login screen covers everything. Not during a ride: the ride carries on
// and, if its save is refused, it is kept and retried after logging in.
const SESSION_CHECK_MS = 60_000;

export function watchSession(user, { isRiding = () => false } = {}) {
  if (!user) return; // the offline shell has no session to watch
  let checking = false;
  async function check() {
    if (checking || isRiding() || document.getElementById('login-dialog').open) return;
    checking = true;
    try {
      const me = await getMe();
      if (me === null) window.dispatchEvent(new CustomEvent('sisyphus:unauthorized'));
      // Logged in as someone else in another tab: start over as them.
      else if (me.id !== user.id) window.location.reload();
    } catch { /* server unreachable: not a reason to log anyone out */ } finally {
      checking = false;
    }
  }
  setInterval(check, SESSION_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', check);
}

// Settings → Account: who is logged in, change password, log out.
export function initAccount(user) {
  const whoEl = document.getElementById('account-who');
  const currentInput = document.getElementById('account-current-password');
  const newInput = document.getElementById('account-new-password');
  const confirmInput = document.getElementById('account-confirm-password');
  const statusEl = document.getElementById('account-status');

  whoEl.textContent = user ? t('account.who', { name: user.display_name, username: user.username }) : t('account.offline');

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--color-error)' : '';
  }

  document.getElementById('change-password-btn').addEventListener('click', async () => {
    if (newInput.value !== confirmInput.value) {
      setStatus(t('account.mismatch'), true);
      return;
    }
    try {
      await changePassword(currentInput.value, newInput.value);
      currentInput.value = newInput.value = confirmInput.value = '';
      setStatus(t('account.changed'));
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await logout();
    } finally {
      window.location.reload();
    }
  });
}
