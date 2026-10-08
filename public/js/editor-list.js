// Wrapped so that these names belong to this screen only. See site.js.
// The () at the very end calls the function straight away, so everything in it
// runs once, as soon as the browser runs this file. The script tag is defer, so
// that is after the HTML has been read and every element below already exists.
(() => {
const filters = document.getElementById('filters');
const status = document.getElementById('status');
const category = document.getElementById('category');
const q = document.getElementById('q');
const sort = document.getElementById('sort');
const rows = document.getElementById('rows');
const loading = document.getElementById('loading');
const empty = document.getElementById('empty');
const problem = document.getElementById('problem');
const sentinel = document.getElementById('sentinel');

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
  400: 'הסינון אינו תקין. נסו לאפס אותו.',
  401: 'פג תוקף החיבור. יש להתחבר מחדש.',
  403: 'האזור הזה הוא לעורכים.'
};

const explain = (code) => WORDING[code] || 'לא הצלחנו לטעון את הכתבות. נסו שוב.';

const say = (text) => {
  problem.textContent = text;
  problem.hidden = false;
};

const when = (iso) => new Date(iso).toLocaleString('he-IL', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
});

const badge = (state, text) => Object.assign(document.createElement('span'), {
  className: 'status ' + state,
  textContent: text
});

const cell = (...children) => {
  const td = document.createElement('td');
  td.append(...children);
  return td;
};

// textContent throughout: a title is whatever its author typed, and a headline
// of <img onerror=...> would otherwise run.
function render(article) {
  const tr = document.createElement('tr');

  const link = document.createElement('a');
  link.href = '/editor/articles/' + article.id;
  link.textContent = article.title;
  const title = cell(link);
  if (article.liveTitle) {
    title.append(Object.assign(document.createElement('span'), {
      className: 'live-title',
      textContent: 'באוויר: ' + article.liveTitle
    }));
  }
  tr.append(title);

  tr.append(cell(article.reporter ? article.reporter.name : '—'));
  tr.append(cell(CATEGORIES[article.category] || article.category));

  // An article that is out and has a rewrite waiting gets both badges: what the
  // readers see, and what is waiting on the editor. Colour is never the only
  // signal, so each says it in words too.
  const states = document.createElement('span');
  states.className = 'row tight';
  if (article.isLive && article.state !== 'published') states.append(badge('published', 'באוויר'));
  states.append(badge(article.state, article.hasUpdate ? 'עדכון ממתין' : STATES[article.state] || article.state));
  tr.append(cell(states));

  const time = document.createElement('time');
  time.dateTime = article.updatedAt;
  time.textContent = when(article.updatedAt);
  tr.append(cell(time));

  tr.append(cell(article.isLive ? article.viewCount.toLocaleString('he-IL') : '—'));

  const actions = document.createElement('span');
  actions.className = 'row tight';
  const review = Object.assign(document.createElement('a'), {
    className: 'button quiet',
    href: '/editor/articles/' + article.id,
    textContent: article.state === 'pending' ? 'סקירה' : 'פתיחה'
  });
  actions.append(review);
  if (article.isLive) {
    actions.append(Object.assign(document.createElement('a'), {
      className: 'button quiet',
      href: '/editor/analytics?article=' + article.id,
      textContent: 'גרף'
    }));
  }
  tr.append(cell(actions));

  return tr;
}

let cursor = null;
let done = false;
let busy = false;

// Every request carries a number, and an answer to anything but the latest is
// dropped. Typing "ממשלה" sends five searches, and the second could otherwise
// arrive last and paint its rows under the fifth's query.
let generation = 0;

function query() {
  const params = new URLSearchParams({ all: 'true', limit: '20' });
  if (status.value !== 'all') params.set('status', status.value);
  if (category.value) params.set('category', category.value);
  if (q.value.trim()) params.set('q', q.value.trim());
  if (sort.value !== 'updated') params.set('sort', sort.value);
  return params;
}

// The filters live in the address bar too, so the back button from a review
// returns to the same list and a link to it can be shared.
function remember() {
  const params = new URLSearchParams({ status: status.value });
  if (category.value) params.set('category', category.value);
  if (q.value.trim()) params.set('q', q.value.trim());
  if (sort.value !== 'updated') params.set('sort', sort.value);
  history.replaceState(null, '', '?' + params);
}

async function load() {
  if (busy || done) return;
  busy = true;
  problem.hidden = true;
  loading.hidden = false;

  const mine = generation;
  const params = query();
  if (cursor) params.set('after', cursor);

  let response;
  try {
    response = await fetch('/api/articles?' + params);
  } catch {
    response = null;
  }

  if (mine !== generation) return;

  loading.hidden = true;
  busy = false;

  if (!response || !response.ok) {
    done = true;
    say(response ? explain(response.status) : 'אין חיבור לשרת.');
    return;
  }

  const page = await response.json();
  if (mine !== generation) return;

  for (const article of page.articles) rows.append(render(article));

  cursor = page.nextCursor;
  done = !cursor;
  empty.hidden = rows.children.length > 0;

  // A short page can leave the sentinel on screen, and the observer only fires
  // on a crossing. Asking again here is what keeps a tall window filling.
  if (!done && sentinel.getBoundingClientRect().top < window.innerHeight) load();
}

function restart() {
  generation++;
  busy = false;
  rows.replaceChildren();
  cursor = null;
  done = false;
  empty.hidden = true;
  remember();
  load();
}

// Whatever the address bar asked for, so a reload or the back button lands on
// the same list. The status already came from the server.
const asked = new URLSearchParams(location.search);
if (asked.get('category')) category.value = asked.get('category');
if (asked.get('q')) q.value = asked.get('q');
if (asked.get('sort')) sort.value = asked.get('sort');

let typing;
q.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(restart, 300);
});

for (const select of [status, category, sort]) select.addEventListener('change', restart);

// Enter in the search box would otherwise submit the form and reload the page.
filters.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(typing);
  restart();
});

// An observer rather than a scroll listener, which would fire on every pixel.
new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) load();
}, { rootMargin: '300px' }).observe(sentinel);

load();
})();
