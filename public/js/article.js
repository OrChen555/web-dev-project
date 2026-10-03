// Wrapped so that these names belong to this screen only. See site.js.
(() => {
const root = document.querySelector('[data-article]');
const section = document.getElementById('comments');
const form = document.getElementById('comment-form');
const author = document.getElementById('author');
const text = document.getElementById('text');
const send = document.getElementById('send');
const formProblem = document.getElementById('form-problem');
const list = document.getElementById('comment-list');
const loading = document.getElementById('comments-loading');
const empty = document.getElementById('comments-empty');
const problem = document.getElementById('comments-problem');
const problemText = document.getElementById('comments-problem-text');
const retry = document.getElementById('comments-retry');
const more = document.getElementById('more');
const counter = document.getElementById('comment-count');

const id = root.dataset.article;
const isEditor = section.dataset.editor === 'true';
const api = '/api/articles/' + id;

let cursor = null;
let busy = false;

// The server answers in English, which is right for the log and wrong for the
// screen. The wording a reader sees is decided here, from the status.
const WORDING = {
  400: 'השם או התגובה אינם תקינים.',
  404: 'הכתבה כבר לא זמינה.',
  429: 'ניתן לפרסם עד שלוש תגובות בדקה.'
};

const explain = (code) => WORDING[code] || 'משהו השתבש. נסו שוב בעוד רגע.';

// The API sends ISO in UTC; formatting for a reader belongs here.
const when = (iso) => new Date(iso).toLocaleString('he-IL', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
});

function setCount(delta) {
  counter.textContent = String(Math.max(0, Number(counter.textContent) + delta));
}

// textContent throughout: a comment is whatever a stranger typed, and a comment
// of <img onerror=...> would otherwise run.
function render(comment) {
  const item = document.createElement('li');
  item.className = 'comment';
  item.dataset.id = comment.id;

  const head = document.createElement('div');
  head.className = 'head';

  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = comment.author;

  const time = document.createElement('time');
  time.className = 'when';
  time.dateTime = comment.createdAt;
  time.textContent = when(comment.createdAt);

  head.append(who, time);

  if (comment.edited) {
    const mark = document.createElement('span');
    mark.className = 'when';
    mark.textContent = '(נערכה)';
    head.append(mark);
  }

  const body = document.createElement('p');
  body.textContent = comment.text;

  if (isEditor) {
    const tools = document.createElement('div');
    tools.className = 'tools';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'quiet';
    edit.textContent = 'עריכה';
    edit.addEventListener('click', () => startEdit(comment, item, body, tools));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'quiet';
    remove.textContent = 'מחיקה';
    remove.addEventListener('click', () => confirmRemove(comment, item, remove));

    tools.append(edit, remove);
    head.append(tools);
  }

  item.append(head, body);
  return item;
}

// The text turns into a box in place. Saving swaps the whole row for a fresh one
// built from the server's answer, so what is on screen is what was stored.
function startEdit(comment, item, body, tools) {
  const box = document.createElement('textarea');
  box.rows = 3;
  box.maxLength = 2000;
  box.value = comment.text;
  box.setAttribute('aria-label', 'עריכת התגובה');

  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'שמירה';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'ביטול';

  const warn = document.createElement('p');
  warn.className = 'problem';
  warn.setAttribute('role', 'alert');
  warn.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(save, cancel);

  const editor = document.createElement('div');
  editor.append(box, warn, actions);

  tools.hidden = true;
  body.replaceWith(editor);
  box.focus();

  cancel.addEventListener('click', () => {
    editor.replaceWith(body);
    tools.hidden = false;
  });

  save.addEventListener('click', async () => {
    save.disabled = true;

    const response = await fetch('/api/comments/' + comment.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: box.value })
    }).catch(() => null);

    if (!response || !response.ok) {
      warn.textContent = response && response.status === 400 ? 'התגובה אינה יכולה להיות ריקה.' : 'לא הצלחנו לשמור את התגובה.';
      warn.hidden = false;
      save.disabled = false;
      return;
    }

    item.replaceWith(render(await response.json()));
  });
}

async function confirmRemove(comment, item, button) {
  const yes = await site.confirm({
    heading: 'מחיקת תגובה',
    message: 'התגובה של ' + comment.author + ' תימחק לצמיתות.',
    action: 'מחיקה',
    danger: true
  });
  if (!yes) return;

  button.disabled = true;
  const response = await fetch('/api/comments/' + comment.id, { method: 'DELETE' }).catch(() => null);

  if (!response || !response.ok) {
    button.disabled = false;
    problemText.textContent = 'לא הצלחנו למחוק את התגובה.';
    problem.hidden = false;
    retry.hidden = true;
    return;
  }

  item.remove();
  setCount(-1);
  empty.hidden = list.children.length > 0;
}

async function load() {
  if (busy) return;
  busy = true;

  problem.hidden = true;
  more.hidden = true;
  loading.hidden = false;

  try {
    const response = await fetch(api + '/comments' + (cursor ? '?after=' + encodeURIComponent(cursor) : ''));
    if (!response.ok) throw response.status;

    const page = await response.json();
    page.comments.forEach((comment) => list.append(render(comment)));

    cursor = page.nextCursor;
    more.hidden = !cursor;
    empty.hidden = list.children.length > 0;
  } catch (err) {
    problemText.textContent = 'לא הצלחנו לטעון את התגובות.';
    retry.hidden = false;
    problem.hidden = false;
  } finally {
    loading.hidden = true;
    busy = false;
  }
}

retry.addEventListener('click', load);
more.addEventListener('click', load);

// Past the limit the button counts down, so the reader sees when they may post
// again instead of pressing it and getting the same refusal.
function cool(seconds) {
  send.disabled = true;

  const tick = () => {
    if (seconds <= 0) {
      send.disabled = false;
      send.textContent = 'פרסום תגובה';
      formProblem.hidden = true;
      return;
    }
    send.textContent = 'אפשר שוב בעוד ' + seconds + ' שנ׳';
    seconds -= 1;
    setTimeout(tick, 1000);
  };

  tick();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formProblem.hidden = true;

  // Checked here first so that each problem gets its own sentence. The server
  // checks the same two things again and answers 400 for either, which is
  // why its wording above covers both.
  const missing = !author.value.trim() || !text.value.trim();
  const tooLong = author.value.trim().length > author.maxLength
    || text.value.trim().length > text.maxLength;

  if (missing || tooLong) {
    formProblem.textContent = missing ? 'יש למלא שם ותגובה.' : 'השם או התגובה ארוכים מהמותר.';
    formProblem.hidden = false;
    return;
  }

  send.disabled = true;

  try {
    const response = await fetch(api + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: author.value, text: text.value })
    });

    if (response.status === 429) {
      const wait = Number(response.headers.get('Retry-After')) || 60;
      formProblem.textContent = explain(429);
      formProblem.hidden = false;
      cool(wait);
      return;
    }

    if (!response.ok) throw response.status;

    // The comment comes back from the POST, so it goes straight on the list.
    // Re-fetching the whole list to show one new row is what this avoids.
    const comment = await response.json();
    const item = render(comment);
    item.classList.add('fresh');
    list.prepend(item);

    setCount(1);
    empty.hidden = true;
    text.value = '';

    try { localStorage.setItem('commenter', author.value.trim()); } catch (e) {}
    send.disabled = false;
  } catch (err) {
    formProblem.textContent = explain(typeof err === 'number' ? err : 0);
    formProblem.hidden = false;
    send.disabled = false;
  }
});

try { author.value = localStorage.getItem('commenter') || ''; } catch (e) {}

load();
})();
