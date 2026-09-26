// Wrapped so that these names belong to this screen only. See site.js.
(() => {
const feed = document.getElementById('feed');
const form = document.getElementById('filters');
const empty = document.getElementById('feed-empty');
const failed = document.getElementById('feed-error');
const retry = document.getElementById('feed-retry');
const cardTemplate = document.getElementById('card-template');
const skeletonTemplate = document.getElementById('skeleton-template');

// Enough placeholders to fill a screen, not a whole page of twenty.
const SKELETONS = 4;

// A request that never answers would leave the skeletons shimmering forever,
// which looks like loading rather than like something being wrong.
const TIMEOUT_MS = 10000;

// The Hebrew name of each category is already on the page, as the options of
// the category filter. Reading it from there keeps one list rather than two.
const CATEGORY_NAMES = Object.fromEntries(
  [...form.elements.category.options].filter((o) => o.value).map((o) => [o.value, o.textContent])
);

// "20 בספטמבר", with the year only when it is not this year's.
const SAME_YEAR = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' });
const OTHER_YEAR = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

function hebrewDate(date) {
  const format = date.getFullYear() === new Date().getFullYear() ? SAME_YEAR : OTHER_YEAR;
  return format.format(date);
}

// The filters as the API reads them. An empty field is left out rather than
// sent empty, so the request says only what the reader actually chose.
function query() {
  const params = new URLSearchParams();
  for (const [name, value] of new FormData(form)) {
    if (value.trim()) params.set(name, value.trim());
  }
  return params;
}

// Everything a reporter typed goes in with textContent, never innerHTML: a title
// of <img src=x onerror=...> would otherwise run on every reader's screen.
function card(article) {
  const node = cardTemplate.content.cloneNode(true);
  const slot = (name) => node.querySelector(`[data-slot="${name}"]`);

  const link = slot('link');
  link.href = '/articles/' + encodeURIComponent(article.id);
  link.textContent = article.title;
  slot('summary').textContent = article.summary;

  // The grey placeholder stays when there is no image, and takes the picture's
  // place if the picture turns out to be missing or broken.
  const image = slot('image');
  const placeholder = slot('no-image');
  if (article.image) {
    image.addEventListener('error', () => image.replaceWith(placeholder), { once: true });
    image.src = article.image;
    image.hidden = false;
    placeholder.remove();
  } else {
    image.remove();
  }

  // An account can be deleted after it wrote something; the byline then starts
  // at the category rather than with a separator in front of nothing.
  const reporter = slot('reporter');
  if (article.reporter && article.reporter.name) {
    reporter.textContent = article.reporter.name;
  } else {
    reporter.nextElementSibling.remove();
    reporter.remove();
  }

  slot('category').textContent = CATEGORY_NAMES[article.category] || article.category;

  // Checked for a value first: new Date(null) is not invalid, it is 1970.
  const published = slot('published');
  const at = article.publishedAt ? new Date(article.publishedAt) : null;
  if (!at || Number.isNaN(at.getTime())) {
    published.previousElementSibling.remove();
    published.remove();
  } else {
    published.dateTime = article.publishedAt;
    published.textContent = hebrewDate(at);
  }

  slot('seen').hidden = !article.seen;

  return node;
}

// One of four things is on screen at a time: placeholders, cards, the empty
// message or the error. Each call sets all three blocks, so no two can show
// together whatever order the answers come back in.
function show(state, articles = []) {
  feed.setAttribute('aria-busy', String(state === 'loading'));
  empty.hidden = state !== 'empty';
  failed.hidden = state !== 'error';

  if (state === 'loading') {
    feed.replaceChildren(...Array.from({ length: SKELETONS }, () => skeletonTemplate.content.cloneNode(true)));
  } else {
    feed.replaceChildren(...articles.map(card));
  }
}

// A retry pressed twice, or a later load started before an earlier one
// answered: only the newest request is allowed to change the screen.
let latest = 0;

async function load() {
  const mine = ++latest;
  show('loading');
  retry.disabled = true;

  try {
    const response = await fetch('/api/articles?' + query(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) throw new Error('The feed answered ' + response.status);

    const { articles } = await response.json();
    if (mine !== latest) return;
    show(articles.length ? 'cards' : 'empty', articles);
  } catch (err) {
    if (mine !== latest) return;
    show('error');
  } finally {
    if (mine === latest) retry.disabled = false;
  }
}

// The button hides itself while the retry runs, which drops keyboard focus to
// the top of the page. Put it back: on the new cards if the retry worked, on
// the button again if it did not.
retry.addEventListener('click', async () => {
  await load();
  (failed.hidden ? feed : retry).focus();
});

load();
})();
