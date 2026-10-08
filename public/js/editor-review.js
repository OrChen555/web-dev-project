// Wrapped so that these names belong to this screen only. See site.js.
// The () at the very end calls the function straight away, so everything in it
// runs once, as soon as the browser runs this file. The script tag is defer, so
// that is after the HTML has been read and every element below already exists.
(() => {
const review = document.getElementById('review');
const problem = document.getElementById('problem');
const approve = document.getElementById('approve');
const sendBack = document.getElementById('return');
const remove = document.getElementById('delete');
const edit = document.getElementById('edit');
const form = document.getElementById('form');
const saved = document.getElementById('saved');
const actions = document.getElementById('actions');
const dialog = document.getElementById('send-back');
const note = document.getElementById('note');
const noteGo = document.getElementById('note-go');
const noteNo = document.getElementById('note-no');
const noteProblem = document.getElementById('note-problem');
const compare = document.getElementById('compare');
const marks = document.getElementById('marks');
const changed = document.getElementById('changed');

const id = review.dataset.id;

// The server answers in English, which is right for the log but not for the
// screen. The wording a person reads is decided here, from the status.
const WORDING = {
  400: 'הבקשה אינה תקינה.',
  401: 'פג תוקף החיבור. יש להתחבר מחדש.',
  403: 'רק עורך יכול לבצע את הפעולה הזאת.',
  404: 'הכתבה כבר לא קיימת.',
  409: 'מצב הכתבה השתנה בינתיים. רעננו את הדף.'
};

const explain = (code) => WORDING[code] || 'משהו השתבש. נסו שוב.';

const say = (text) => {
  problem.textContent = text;
  problem.hidden = false;
};

// One request, and an answer the caller can read the same way whether the
// server refused or the network did.
async function send(method, url, body) {
  try {
    return await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    return { ok: false, status: 0 };
  }
}

const reloadWith = (done) => {
  location.href = location.pathname + (done ? '?done=' + done : '');
};

// The actions ---------------------------------------------------------------

if (approve) {
  approve.addEventListener('click', async () => {
    const sure = await site.confirm({
      heading: 'לאשר ולפרסם?',
      message: compare
        ? 'הגרסה החדשה תחליף את הגרסה המפורסמת ותוצג לקוראים מיד.'
        : 'הכתבה תפורסם באתר ותוצג לקוראים מיד.',
      action: 'אישור ופרסום'
    });
    if (!sure) return;

    approve.disabled = true;
    problem.hidden = true;

    const response = await send('POST', '/api/articles/' + id + '/approve');
    if (response.ok) return reloadWith('approved');

    approve.disabled = false;
    say(response.status ? explain(response.status) : 'אין חיבור לשרת.');
  });
}

if (sendBack) {
  sendBack.addEventListener('click', () => {
    noteProblem.hidden = true;
    note.removeAttribute('aria-invalid');
    dialog.showModal();
    note.focus();
  });

  noteNo.addEventListener('click', () => dialog.close());

  noteGo.addEventListener('click', async () => {
    // Checked here for a quick answer, and again by the server, which is the
    // check that counts.
    if (!note.value.trim()) {
      note.setAttribute('aria-invalid', 'true');
      noteProblem.textContent = 'יש לכתוב לכתב אילו תיקונים נדרשים.';
      noteProblem.hidden = false;
      note.focus();
      return;
    }

    noteGo.disabled = true;
    const response = await send('POST', '/api/articles/' + id + '/return', { note: note.value.trim() });
    if (response.ok) return reloadWith('returned');

    // Left open, so the note that was typed is not lost.
    noteGo.disabled = false;
    noteProblem.textContent = response.status ? explain(response.status) : 'אין חיבור לשרת.';
    noteProblem.hidden = false;
  });
}

remove.addEventListener('click', async () => {
  const sure = await site.confirm({
    heading: 'למחוק את הכתבה?',
    message: 'הכתבה תימחק לצמיתות יחד עם התגובות ונתוני הצפייה שלה. אי אפשר לבטל את זה.',
    action: 'מחיקה',
    danger: true
  });
  if (!sure) return;

  remove.disabled = true;
  problem.hidden = true;

  const response = await send('DELETE', '/api/articles/' + id);
  if (response.ok) {
    location.href = '/editor/articles';
    return;
  }

  remove.disabled = false;
  say(response.status ? explain(response.status) : 'אין חיבור לשרת.');
});

// Editing -------------------------------------------------------------------
//
// The same autosave the reporter's screen uses: every change goes to PATCH a
// moment after typing stops, into the working copy only. The published version
// cannot be reached from here, which is the whole point of keeping two.

const fields = ['title', 'summary', 'body', 'image'];
const input = {};
for (const name of fields) input[name] = document.getElementById(name);

let stored = {};
let timer;
let saving = null;

const WAIT = 800;

const shownAt = () => new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

function changes() {
  const body = {};
  for (const name of fields) {
    const value = input[name].value.trim();
    if (value !== stored[name]) body[name] = value;
  }
  return body;
}

// Returns the save in flight, so that finishing can wait for it rather than
// reloading over a request that has not landed.
function save() {
  if (saving) return saving.then(save);

  const body = changes();
  if (!Object.keys(body).length) return Promise.resolve(true);

  saved.textContent = 'שומר…';
  problem.hidden = true;

  saving = send('PATCH', '/api/articles/' + id, body).then(async (response) => {
    saving = null;

    if (!response.ok) {
      saved.textContent = '';
      say(response.status ? explain(response.status) : 'אין חיבור לשרת. השינויים לא נשמרו.');
      return false;
    }

    // Read back what was stored: a field left empty keeps its previous value.
    const article = await response.json();
    for (const name of fields) {
      stored[name] = article[name] || '';
      if (document.activeElement !== input[name]) input[name].value = stored[name];
    }
    saved.textContent = 'נשמר ב־' + shownAt();
    return true;
  });

  return saving;
}

if (edit) {
  edit.addEventListener('click', () => {
    stored = {};
    for (const name of fields) stored[name] = input[name].value.trim();

    form.hidden = false;
    actions.hidden = true;
    if (compare) compare.hidden = true;
    input.title.focus();
  });

  for (const name of fields) {
    input[name].addEventListener('input', () => {
      clearTimeout(timer);
      saved.textContent = 'לא נשמר';
      timer = setTimeout(save, WAIT);
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearTimeout(timer);

    // Reloaded rather than patched in place, so the comparison is drawn again
    // from what the server now holds.
    if (await save()) reloadWith(null);
  });

  window.addEventListener('beforeunload', (event) => {
    if (!form.hidden && Object.keys(changes()).length) event.preventDefault();
  });
}

// The comparison ------------------------------------------------------------
//
// Both versions are already in the HTML, rendered by the server. This only
// marks what differs: the title, summary or image if it changed, and in the
// body every paragraph that is in one version and not in the other.

if (compare) {
  const NAMES = { title: 'כותרת', summary: 'תקציר', image: 'תמונה', body: 'גוף הכתבה' };
  const field = (version, name) => compare.querySelector('[data-version="' + version + '"] [data-field="' + name + '"]');
  const touched = [];

  for (const name of ['title', 'summary', 'image']) {
    const before = field('old', name);
    const after = field('new', name);

    // The image is compared by its address, which the page keeps in data-value.
    const read = (element) => (name === 'image' ? element.dataset.value : element.textContent.trim());

    if (read(before) !== read(after)) {
      before.classList.add('removed');
      after.classList.add('added');
      touched.push(NAMES[name]);
    }
  }

  // A paragraph is "the same" if the other version has one with exactly that
  // text, wherever it is. Anything else was removed (in the old copy) or added
  // (in the new one).
  const paragraphs = (version) => [...field(version, 'body').children];
  const texts = (version) => new Set(paragraphs(version).map((p) => p.textContent.trim()));
  const oldTexts = texts('old');
  const newTexts = texts('new');
  let bodyChanged = false;

  for (const p of paragraphs('old')) {
    if (!newTexts.has(p.textContent.trim())) { p.classList.add('removed'); bodyChanged = true; }
  }
  for (const p of paragraphs('new')) {
    if (!oldTexts.has(p.textContent.trim())) { p.classList.add('added'); bodyChanged = true; }
  }
  if (bodyChanged) touched.push(NAMES.body);

  changed.textContent = touched.length
    ? 'השתנו: ' + touched.join(', ') + '.'
    : 'אין הבדל בתוכן בין שתי הגרסאות.';

  // The marks are classes that stay put; the colours only show while the
  // compare box has .marking, so the checkbox just switches that one class.
  marks.addEventListener('change', () => compare.classList.toggle('marking', marks.checked));
}
})();
