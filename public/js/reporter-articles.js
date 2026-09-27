// Wrapped so that these names belong to this screen only. See site.js.
(() => {
const rows = document.getElementById('rows');
const loading = document.getElementById('loading');
const empty = document.getElementById('empty');
const problem = document.getElementById('problem');
const sentinel = document.getElementById('sentinel');
const status = document.getElementById('status');

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
  400: 'הסינון אינו תקין.',
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

// A date a reader can read. The API sends ISO in UTC and the formatting belongs
// here, not there.
const when = (iso) => new Date(iso).toLocaleDateString('he-IL', {
  day: 'numeric', month: 'long'
});

// textContent throughout: a title is whatever its author typed, and a headline
// of <img onerror=...> would otherwise run.
function render(article) {
  const card = document.createElement('article');
  card.className = 'card';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (article.image) {
    thumb.style.backgroundImage = 'url("' + encodeURI(article.image) + '")';
    thumb.style.backgroundSize = 'cover';
  }
  card.append(thumb);

  const body = document.createElement('div');

  const heading = document.createElement('h2');
  heading.textContent = article.title;
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

  // The editor asked for something. It is the reason this article is back, so it
  // is on the card rather than a click away.
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

// Fetching as the end of the list comes into view. The observer is cheap where a
// scroll listener fires on every pixel.
new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) load();
}, { rootMargin: '300px' }).observe(sentinel);

load();
})();
