// Wrapped so that these names belong to this screen only. See site.js.
(() => {
const rows = document.getElementById('rows');
const form = document.getElementById('create');
const problem = document.getElementById('problem');
const created = document.getElementById('created');

const ROLES = { reporter: 'כתב', editor: 'עורך' };

// One message showing at a time. Both are cleared before every action, so a
// success line can never sit above a failure that came after it.
let fade;

const clear = () => {
  clearTimeout(fade);
  problem.hidden = true;
  created.hidden = true;
};

const say = (text) => {
  clear();
  problem.textContent = text;
  problem.hidden = false;
};

// Success takes itself away after a few seconds; a failure stays until the next
// action, because it is asking for something to be done about it.
//
// clear() cancels the pending hide, so two creations in a row restart the five
// seconds rather than the first one cutting the second one short.
const cheer = (text) => {
  clear();
  created.textContent = text;
  created.hidden = false;
  fade = setTimeout(() => { created.hidden = true; }, 5000);
};

// The server answers in English, which is right for the log but not for the
// screen. The wording a person reads is decided here, from the status.
const WORDING = {
  400: 'חסרים פרטים, או שהתפקיד אינו תקין.',
  401: 'פג תוקף החיבור. יש להתחבר מחדש.',
  403: 'רק מנהל המערכת רשאי לעשות זאת.',
  404: 'החשבון כבר אינו קיים.',
  409: 'שם המשתמש הזה כבר תפוס.'
};

const explain = (status) => WORDING[status] || 'משהו השתבש. נסו שוב.';

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
  if (!response.ok) return say('לא ניתן לטעון את רשימת החשבונות.');

  const users = await response.json();
  rows.replaceChildren(...users.map(row));
}

async function destroy(user) {
  const sure = await site.confirm({
    heading: 'מחיקת חשבון',
    message: `החשבון ${user.username} יימחק לצמיתות. לא ניתן לבטל את הפעולה.`,
    action: 'מחיקה',
    danger: true
  });

  if (!sure) return;
  clear();

  const response = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });

  if (response.ok) {
    cheer(`החשבון ${user.username} נמחק.`);
    return load();
  }

  say(explain(response.status));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clear();

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
    const user = await response.json();
    form.reset();

    // Name the account rather than saying "done". Somebody who mistyped the
    // username finds out here instead of in the table.
    cheer(`החשבון ${user.username} נוצר, בתפקיד ${ROLES[user.role] || user.role}.`);

    form.username.focus();
    return load();
  }

  say(explain(response.status));
});

load();
})();
