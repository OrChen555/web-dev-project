// Wrapped so that these names belong to this screen only. See site.js.
(() => {
const editor = document.getElementById('editor');
const form = document.getElementById('form');
const loading = document.getElementById('loading');
const problem = document.getElementById('problem');
const badge = document.getElementById('badge');
const saved = document.getElementById('saved');
const locked = document.getElementById('locked');
const note = document.getElementById('note');
const noteText = document.getElementById('note-text');
const preview = document.getElementById('preview');
const send = document.getElementById('send');

const id = editor.dataset.id;
const fields = ['title', 'summary', 'body', 'image'];
const input = {};
for (const name of fields) input[name] = document.getElementById(name);
const category = document.getElementById('category');

const STATES = {
  draft: 'בהכנה',
  pending: 'ממתינה לאישור',
  returned: 'הוחזרה לתיקונים',
  published: 'פורסמה'
};

const CATEGORIES = {
  news: 'חדשות',
  politics: 'פוליטיקה',
  economy: 'כלכלה',
  sports: 'ספורט',
  culture: 'תרבות',
  technology: 'טכנולוגיה',
  health: 'בריאות'
};

// The server answers in English, which is right for the log but not for the
// screen. The wording a person reads is decided here, from the status.
const WORDING = {
  400: 'אחד השדות אינו תקין.',
  401: 'פג תוקף החיבור. יש להתחבר מחדש.',
  403: 'הכתבה הזאת אינה שלכם.',
  404: 'הכתבה אינה קיימת, או שאינה שלכם.',
  409: 'מצב הכתבה השתנה. רעננו את הדף.'
};

const explain = (code) => WORDING[code] || 'משהו השתבש. נסו שוב.';

const say = (text) => {
  problem.textContent = text;
  problem.hidden = false;
};

// What the server last confirmed. A save sends the difference against this, and
// an ignored blank falls back to it.
let stored = {};
let state = null;

// revise answers 409 the second time, so it happens once, before the first save.
let needsRevise = false;

let timer;
let saving = false;
let again = false;

const WAIT = 800;

const shownAt = () => new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

function paint(article) {
  state = article.state;
  stored = {};
  for (const name of fields) {
    stored[name] = article[name] || '';
    input[name].value = stored[name];
  }

  category.value = CATEGORIES[article.category] || article.category;
  badge.className = 'status ' + state;
  badge.textContent = STATES[state] || state;
  badge.hidden = false;

  needsRevise = state === 'published';

  // Once it is sent it is the editor's until they approve it or send it back.
  const frozen = state === 'pending';
  for (const name of fields) input[name].disabled = frozen;
  send.disabled = frozen;
  locked.hidden = !frozen;

  if (article.editorNote) {
    noteText.textContent = 'הוחזרה לתיקונים: ' + article.editorNote.text;
    note.hidden = false;
  }

  drawPreview();
}

function drawPreview() {
  const url = input.image.value.trim();
  preview.style.backgroundImage = url ? 'url("' + encodeURI(url) + '")' : '';
}

function changes() {
  const body = {};
  for (const name of fields) {
    const value = input[name].value.trim();
    if (value !== stored[name]) body[name] = value;
  }
  return body;
}

async function save() {
  if (saving) { again = true; return; }

  const body = changes();
  if (!Object.keys(body).length) return;

  saving = true;
  problem.hidden = true;
  saved.textContent = 'שומר…';

  // The working copy has to exist before it can be written to.
  if (needsRevise) {
    const opened = await fetch('/api/articles/' + id + '/revise', { method: 'POST' });
    if (!opened.ok) {
      saving = false;
      saved.textContent = '';
      say(explain(opened.status));
      return;
    }
    needsRevise = false;
    state = 'draft';
    badge.className = 'status draft';
    badge.textContent = STATES.draft;
  }

  const response = await fetch('/api/articles/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  saving = false;

  if (!response.ok) {
    saved.textContent = '';
    say(explain(response.status));
    return;
  }

  // Read back what was stored rather than assuming the body went in as sent: a
  // field left empty keeps its previous value, and the field should show that.
  const article = await response.json();
  for (const name of fields) {
    stored[name] = article[name] || '';
    if (document.activeElement !== input[name]) input[name].value = stored[name];
  }

  saved.textContent = 'נשמר ב־' + shownAt();

  // Typing carried on while that was in flight.
  if (again) { again = false; save(); }
}

const queue = () => {
  clearTimeout(timer);
  saved.textContent = 'לא נשמר';
  timer = setTimeout(save, WAIT);
};

async function load() {
  const response = await fetch('/api/articles/' + id);
  loading.hidden = true;

  if (!response.ok) {
    say(explain(response.status));
    return;
  }

  paint(await response.json());
  form.hidden = false;
}

for (const name of fields) {
  input[name].addEventListener('input', queue);
}

input.image.addEventListener('input', drawPreview);

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  // Anything still waiting on the timer goes now, or it would be sent to the
  // editor without the last thing that was typed.
  clearTimeout(timer);
  await save();

  const sure = await site.confirm({
    heading: 'לשלוח לאישור עורך?',
    message: 'הכתבה תעבור לעורך ולא תהיה ניתנת לעריכה עד שיאשר אותה או יחזיר אותה.',
    action: 'שליחה'
  });
  if (!sure) return;

  problem.hidden = true;
  send.disabled = true;

  const response = await fetch('/api/articles/' + id + '/submit', { method: 'POST' });

  if (!response.ok) {
    send.disabled = false;
    say(explain(response.status));
    return;
  }

  // Closed here rather than reloading, so the change is visible.
  state = 'pending';
  badge.className = 'status pending';
  badge.textContent = STATES.pending;
  for (const name of fields) input[name].disabled = true;
  locked.hidden = false;
  note.hidden = true;
  saved.textContent = '';
});

// A tab closed inside the debounce would lose the last thing typed. The browser
// decides the wording; all we can do is ask.
window.addEventListener('beforeunload', (event) => {
  if (Object.keys(changes()).length) event.preventDefault();
});

load();
})();
