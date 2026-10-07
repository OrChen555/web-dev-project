// Wrapped so that these names belong to this screen only. See site.js.
(() => {
const rows = document.getElementById('rows');
const loading = document.getElementById('loading');
const empty = document.getElementById('empty');
const problem = document.getElementById('problem');
const sentinel = document.getElementById('sentinel');
const status = document.getElementById('status');
const start = document.getElementById('new');
const pick = document.getElementById('pick');
const pickCategory = document.getElementById('pick-category');
const pickGo = document.getElementById('pick-go');
const pickNo = document.getElementById('pick-no');
const pickProblem = document.getElementById('pick-problem');

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
  400: 'הבקשה אינה תקינה.',
  401: 'פג תוקף החיבור. יש להתחבר מחדש.',
  403: 'האזור הזה הוא לכתבים.'
};

const explain = (code) => WORDING[code] || 'לא הצלחנו לטעון את הכתבות. נסו שוב.';

let cursor = null;
let done = false;
let busy = false;

const say = (text) => {
  problem.textContent = text;
  problem.hidden = false;
};

// The API sends ISO in UTC; formatting for a reader belongs here.
const when = (iso) => new Date(iso).toLocaleDateString('he-IL', {
  day: 'numeric', month: 'long'
});

// textContent throughout: a title is whatever its author typed, and a headline
// of <img onerror=...> would otherwise run.
function render(article) {
  const card = document.createElement('article');

  card.className = 'card opens';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (article.image) {
    thumb.style.backgroundImage = 'url("' + encodeURI(article.image) + '")';
    thumb.style.backgroundSize = 'cover';
  }
  card.append(thumb);

  const body = document.createElement('div');

  // A link rather than a click handler, stretched over the card by the CSS: the
  // keyboard, the middle button and a new tab all keep working.
  const heading = document.createElement('h2');
  const link = document.createElement('a');
  link.href = '/reporter/articles/' + article.id;
  link.textContent = article.title;
  heading.append(link);
  body.append(heading);

  const summary = document.createElement('p');
  summary.textContent = article.summary;
  body.append(summary);

  const byline = document.createElement('p');
  byline.className = 'byline';

  const badge = document.createElement('span');
  badge.className = 'status ' + article.state;
  badge.textContent = STATES[article.state] || article.state;
  byline.append(badge);

  const category = document.createElement('span');
  category.className = 'sep';
  category.textContent = '·';
  byline.append(category, Object.assign(document.createElement('span'), {
    textContent: CATEGORIES[article.category] || article.category
  }));

  const dot = document.createElement('span');
  dot.className = 'sep';
  dot.textContent = '·';
  const time = document.createElement('time');
  time.dateTime = article.updatedAt;
  time.textContent = when(article.updatedAt);
  byline.append(dot, time);

  body.append(byline);

  if (article.editorNote) {
    const note = document.createElement('div');
    note.className = 'notice bad';
    const text = document.createElement('p');
    text.textContent = 'הוחזרה לתיקונים: ' + article.editorNote.text;
    note.append(text);
    body.append(note);
  }

  card.append(body);
  return card;
}

async function load() {
  if (busy || done) return;
  busy = true;
  problem.hidden = true;
  loading.hidden = false;

  const query = new URLSearchParams({ mine: 'true', limit: '20' });
  if (status.value) query.set('status', status.value);
  if (cursor) query.set('after', cursor);

  const response = await fetch('/api/articles?' + query);

  if (!response.ok) {
    loading.hidden = true;
    busy = false;
    done = true;
    say(explain(response.status));
    return;
  }

  const page = await response.json();
  for (const article of page.articles) rows.append(render(article));

  cursor = page.nextCursor;
  done = !cursor;
  loading.hidden = true;
  empty.hidden = rows.children.length > 0;
  busy = false;

  // A short page can leave the sentinel still on screen, and the observer only
  // fires on a crossing. Asking again here is what keeps a tall window filling.
  if (!done && sentinel.getBoundingClientRect().top < window.innerHeight) load();
}

function restart() {
  rows.replaceChildren();
  cursor = null;
  done = false;
  empty.hidden = true;
  load();
}

status.addEventListener('change', restart);

// A new article has to arrive complete: the endpoint refuses one without a title,
// a summary and a body. These stand in until they are typed over, and the title
// is a real phrase so the row in the list reads as something.
const PLACEHOLDER = { title: 'כתבה חדשה', summary: '—', body: '—' };

start.addEventListener('click', () => {
  pickProblem.hidden = true;
  pick.showModal();
  pickCategory.focus();
});

pickNo.addEventListener('click', () => pick.close());

// disabled stops the next click being painted, not one already on its way, so the
// flag is what actually keeps a double click from filing two articles.
let filing = false;

pickGo.addEventListener('click', async () => {
  if (filing) return;
  filing = true;
  pickGo.disabled = true;
  pickProblem.hidden = true;

  const response = await fetch('/api/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...PLACEHOLDER, category: pickCategory.value })
  });

  if (!response.ok) {
    // Left open, so whatever was picked is still picked.
    filing = false;
    pickGo.disabled = false;
    pickProblem.textContent = explain(response.status);
    pickProblem.hidden = false;
    return;
  }

  const article = await response.json();
  location.href = '/reporter/articles/' + article.id;
});

// An observer rather than a scroll listener, which would fire on every pixel.
new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) load();
}, { rootMargin: '300px' }).observe(sentinel);

load();
})();
