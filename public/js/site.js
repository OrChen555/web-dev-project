// Everything shared between screens. Wrapped so that the names in here cannot
// collide with the names in a page script: five people are writing those, and
// two `const form` in two classic scripts is a syntax error that takes the
// whole page down.
const site = (() => {
  const dialog = document.getElementById('ask');
  const title = document.getElementById('ask-title');
  const body = document.getElementById('ask-body');
  const yes = document.getElementById('ask-yes');
  const no = document.getElementById('ask-no');

  // Replaces window.confirm, which cannot be styled, cannot be translated and
  // blocks the whole tab. Resolves true or false, so a caller reads the same as
  // it did before: if (await site.confirm(...))
  function confirm({ heading, message, action = 'אישור', danger = false }) {
    return new Promise((resolve) => {
      title.textContent = heading;
      body.textContent = message;
      yes.textContent = action;
      yes.className = danger ? 'danger' : '';

      const settle = (answer) => {
        dialog.close();
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click', onNo);
        dialog.removeEventListener('close', onClose);
        resolve(answer);
      };

      const onYes = () => settle(true);
      const onNo = () => settle(false);

      // Escape and the backdrop both fire close, and both mean no.
      const onClose = () => settle(false);

      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
      dialog.addEventListener('close', onClose);

      dialog.showModal();
      no.focus();
    });
  }

  const logout = document.getElementById('logout');

  if (logout) {
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      const response = await fetch('/api/session', { method: 'DELETE' });

      // Either way the session is no longer usable from here, so send them to
      // the public side rather than leaving a signed-out page on screen.
      window.location.href = response.ok ? '/' : '/login';
    });
  }

  const theme = document.getElementById('theme');

  if (theme) {
    theme.addEventListener('click', () => {
      const root = document.documentElement;

      // Without a choice on record the page is following the system, so read
      // what it actually resolved to rather than assuming light.
      const showing = root.dataset.theme
        || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

      const next = showing === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;

      // A browser with site data switched off should still switch, it just will
      // not remember the choice.
      try {
        localStorage.setItem('theme', next);
      } catch (e) {}
    });
  }

  return { confirm };
})();
