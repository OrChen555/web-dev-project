// Wrapped so that these names belong to this screen only. See site.js.
// The () at the very end calls the function straight away, so everything in it
// runs once, as soon as the browser runs this file. The script tag is defer, so
// that is after the HTML has been read and every element below already exists.
(() => {
// The page's elements, looked up once. Some only exist in certain states (see review.ejs).
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
const single = document.querySelector('.single');
const marks = document.getElementById('marks');
const changed = document.getElementById('changed');

// The article being reviewed, from data-id in the HTML.
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

// Turns an HTTP status into a message for the editor.
const explain = (code) => WORDING[code] || 'משהו השתבש. נסו שוב.';

// Review page (/editor/articles/:id): shows an error above the buttons ("אישור ופרסום", "עריכה"...).
const say = (text) => {
  problem.textContent = text;
  problem.hidden = false;
};

// Reloads the page; ?done= makes the server show "הכתבה אושרה ופורסמה" or "הכתבה הוחזרה לכתב".
const reloadWith = (done) => {
  location.href = location.pathname + (done ? '?done=' + done : '');
};

// The actions ---------------------------------------------------------------

// Review page (/editor/articles/:id): the "אישור ופרסום" button. Asks "לאשר ולפרסם?", publishes, reloads.
// The button exists only for pending articles.
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

    const response = await site.request('POST', '/api/articles/' + id + '/approve');
    if (response.ok) return reloadWith('approved');

    approve.disabled = false;
    say(response.status ? explain(response.status) : 'אין חיבור לשרת.');
  });
}

// Review page (/editor/articles/:id): the "החזרה לתיקונים" button opens the note dialog, "החזרה לכתב" sends it.
if (sendBack) {
  sendBack.addEventListener('click', () => {
    noteProblem.hidden = true;
    note.removeAttribute('aria-invalid');
    dialog.showModal();
    note.focus();
  });

  // The dialog's "ביטול" button.
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
    const response = await site.request('POST', '/api/articles/' + id + '/return', { note: note.value.trim() });
    if (response.ok) return reloadWith('returned');

    // Left open, so the note that was typed is not lost.
    noteGo.disabled = false;
    noteProblem.textContent = response.status ? explain(response.status) : 'אין חיבור לשרת.';
    noteProblem.hidden = false;
  });
}

// Review page (/editor/articles/:id): the "מחיקה" button. Asks "למחוק את הכתבה?", then goes back to the list.
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

  const response = await site.request('DELETE', '/api/articles/' + id);
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

// The four edit inputs: "כותרת", "תקציר", "גוף הכתבה", "תמונה".
const fields = ['title', 'summary', 'body', 'image'];
const input = {};
for (const name of fields) input[name] = document.getElementById(name);

// What the server holds now, the autosave timer, and the save in flight.
let stored = {};
let timer;
let saving = null;

const WAIT = 800;

// The time shown in "נשמר ב־...".
const shownAt = () => new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

// Only the fields that differ from what was last saved.
function changes() {
  const body = {};
  for (const name of fields) {
    const value = input[name].value.trim();
    if (value !== stored[name]) body[name] = value;
  }
  return body;
}

// An article that is out with no working copy has nothing to write to yet. The
// first save makes one with revise, which for an editor goes straight to
// pending, and every save after that writes into it. Only once: a second
// revise is refused, because the article is no longer just "published".
let needsRevise = review.dataset.needsRevise === 'true';

// Sends the changes, making a working copy first if there is none yet.
async function write(body) {
  if (needsRevise) {
    const opened = await site.request('POST', '/api/articles/' + id + '/revise');
    if (!opened.ok) return opened;
    needsRevise = false;
  }
  return site.request('PATCH', '/api/articles/' + id, body);
}

// Returns the save in flight, so that finishing can wait for it rather than
// reloading over a request that has not landed.
// Saves whatever changed. Resolves true on success, false on failure.
function save() {
  if (saving) return saving.then(save);

  const body = changes();
  if (!Object.keys(body).length) return Promise.resolve(true);

  saved.textContent = 'שומר…';
  problem.hidden = true;

  saving = write(body).then((response) => {
    saving = null;

    if (!response.ok) {
      saved.textContent = '';
      say(response.status ? explain(response.status) : 'אין חיבור לשרת. השינויים לא נשמרו.');
      return false;
    }

    // Read back what was stored: a field left empty keeps its previous value.
    const article = response.body;
    for (const name of fields) {
      stored[name] = article[name] || '';
      if (document.activeElement !== input[name]) input[name].value = stored[name];
    }
    saved.textContent = 'נשמר ב־' + shownAt();
    return true;
  });

  return saving;
}

// Review page (/editor/articles/:id): the "עריכה" button swaps the read-only view for the edit form.
if (edit) {
  edit.addEventListener('click', () => {
    stored = {};
    for (const name of fields) stored[name] = input[name].value.trim();

    form.hidden = false;
    actions.hidden = true;
    if (compare) compare.hidden = true;
    if (single) single.hidden = true;
    input.title.focus();
  });

  // Autosave: every keystroke restarts the timer, and the save runs after a pause.
  for (const name of fields) {
    input[name].addEventListener('input', () => {
      clearTimeout(timer);
      saved.textContent = 'לא נשמר';
      timer = setTimeout(save, WAIT);
    });
  }

  // The "סיום עריכה" button: saves anything left, then reloads.
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearTimeout(timer);

    // Reloaded rather than patched in place, so the comparison is drawn again
    // from what the server now holds.
    if (await save()) reloadWith(null);
  });

  // Warns before leaving the page with unsaved changes.
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
  // Review page (/editor/articles/:id): field names for the "השתנו: ..." line under "השוואת גרסאות".
  const NAMES = { title: 'כותרת', summary: 'תקציר', image: 'תמונה', body: 'גוף הכתבה' };
  const field = (version, name) => compare.querySelector('[data-version="' + version + '"] [data-field="' + name + '"]');
  const touched = [];

  // The single-value fields: mark both sides if they differ.
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

  // Fills the "השתנו: ..." line, or "אין הבדל בתוכן בין שתי הגרסאות".
  changed.textContent = touched.length
    ? 'השתנו: ' + touched.join(', ') + '.'
    : 'אין הבדל בתוכן בין שתי הגרסאות.';

  // The "סימון ההבדלים" checkbox. The marks stay put; the colours only show while
  // the compare box has .marking, so the checkbox just switches that one class.
  marks.addEventListener('change', () => compare.classList.toggle('marking', marks.checked));
}
})();
