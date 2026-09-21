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

const theme = document.getElementById('theme');

if (theme) {
  theme.addEventListener('click', () => {
    const root = document.documentElement;

    // Without a choice on record, the page is following the system, so read
    // what it actually resolved to rather than assuming light.
    const showing = root.dataset.theme
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    const next = showing === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;

    // A browser with site data switched off should still switch the theme, it
    // just will not remember the choice.
    try {
      localStorage.setItem('theme', next);
    } catch (e) {}
  });
}
