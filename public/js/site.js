// Loaded on every page, for the few things that live in the masthead rather
// than on any one screen.
const logout = document.getElementById('logout');

if (logout) {
  logout.addEventListener('click', async () => {
    logout.disabled = true;

    const response = await fetch('/api/session', { method: 'DELETE' });

    // Either way the session is no longer usable from here, so send them to the
    // public side rather than leaving a signed-out page on screen.
    window.location.href = response.ok ? '/' : '/login';
  });
}
