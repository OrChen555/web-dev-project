const form = document.getElementById('login');
const problem = document.getElementById('problem');
const button = form.querySelector('button');

const say = (text) => {
  problem.textContent = text;
  problem.hidden = false;
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  problem.hidden = true;
  button.disabled = true;

  try {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.username.value, password: form.password.value })
    });

    if (response.ok) {
      const { redirect } = await response.json();
      window.location.href = redirect;
      return;
    }

    // The server answers in English and does not say which of the two was
    // wrong. The wording a person reads belongs here.
    say(response.status === 401 ? 'שם המשתמש או הסיסמה אינם נכונים' : 'משהו השתבש. נסו שוב.');
  } catch {
    say('אין חיבור לשרת.');
  } finally {
    button.disabled = false;
  }
});
