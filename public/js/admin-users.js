const rows = document.getElementById('rows');
const form = document.getElementById('create');
const problem = document.getElementById('problem');

const ROLES = { reporter: 'כתב', editor: 'עורך' };

const say = (text) => {
  problem.textContent = text;
  problem.hidden = false;
};

// textContent and not innerHTML: these names came from a form, and a name of
// <script>...</script> would otherwise run on this page.
function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function row(user) {
  const tr = document.createElement('tr');
  tr.append(cell(user.username), cell(user.name), cell(ROLES[user.role] || user.role));

  const last = document.createElement('td');

  if (user.isAdmin) {
    last.textContent = 'מנהל המערכת';
    last.className = 'muted';
  } else {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'quiet';
    remove.textContent = 'מחיקה';
    remove.addEventListener('click', () => destroy(user));
    last.append(remove);
  }

  tr.append(last);
  return tr;
}

async function load() {
  const response = await fetch('/api/users');
  if (!response.ok) return say('לא ניתן לטעון את רשימת המשתמשים.');

  const users = await response.json();
  rows.replaceChildren(...users.map(row));
}

async function destroy(user) {
  if (!window.confirm(`למחוק את ${user.username}?`)) return;

  const response = await fetch(`/api/users/${user.id || user._id}`, { method: 'DELETE' });
  if (response.ok) return load();

  const body = await response.json().catch(() => ({}));
  say(body.error || 'המחיקה נכשלה.');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  problem.hidden = true;

  const response = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: form.username.value,
      name: form.name.value,
      password: form.password.value,
      role: form.role.value
    })
  });

  if (response.ok) {
    form.reset();
    return load();
  }

  const body = await response.json().catch(() => ({}));
  say(body.error || 'היצירה נכשלה.');
});

load();
