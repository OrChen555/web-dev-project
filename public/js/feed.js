// Wrapped so that these names belong to this screen only. See site.js.
(() => {
const feed = document.getElementById('feed');
const form = document.getElementById('filters');
const empty = document.getElementById('feed-empty');
const failed = document.getElementById('feed-error');
const retry = document.getElementById('feed-retry');
const cardTemplate = document.getElementById('card-template');
const skeletonTemplate = document.getElementById('skeleton-template');
const sentinel = document.getElementById('feed-sentinel');
const end = document.getElementById('feed-end');
const moreFailed = document.getElementById('feed-more-error');
const moreRetry = document.getElementById('feed-more-retry');
const moreBox = document.getElementById('feed-more');
const moreButton = document.getElementById('feed-more-button');

// Enough placeholders to fill a screen, not a whole page of twenty.
const SKELETONS = 4;

// Long enough that a word is finished before it is searched for, short enough
// that the feed still seems to answer the typing.
const DEBOUNCE_MS = 300;

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

// "1,234 צפיות", with the two small cases Hebrew says differently.
const NUMBER = new Intl.NumberFormat('he-IL');

function viewsText(count) {
  if (count === 1) return 'צפייה אחת';
  if (!count) return 'טרם נצפתה';
  return NUMBER.format(count) + ' צפיות';
}

// What each field falls back to. A field at its default is left out of both
// the request and the address bar, so /?sort=recent never appears: the plain
// address already means that.
const DEFAULTS = { q: '', category: '', seen: '', sort: 'recent' };

// The filters as the API reads them, and as the address bar shows them.
function query() {
  const params = new URLSearchParams();
  for (const [name, value] of new FormData(form)) {
    const clean = value.trim();
    if (clean && clean !== DEFAULTS[name]) params.set(name, clean);
  }
  return params;
}

// The address is the starting point, so a shared or reloaded link opens on the
// same feed. It is also something anybody can type: a select only takes a value
// it has an option for, and anything else is dropped rather than sent on to
// earn a 400 from the API.
function fromAddress() {
  const params = new URLSearchParams(window.location.search);
  const q = form.elements.q;
  q.value = (params.get('q') || '').trim().slice(0, q.maxLength);

  for (const name of ['category', 'seen', 'sort']) {
    const select = form.elements[name];
    const wanted = params.get(name);
    const known = [...select.options].some((o) => o.value === wanted);
    select.value = known ? wanted : DEFAULTS[name];
  }
}

// replaceState rather than pushState: a filter is a view of this page, not a
// new page, so Back should leave the feed rather than step through every
// letter that was typed into the search. Nothing here ever reloads the page.
function toAddress(params) {
  const search = params.toString();
  const url = window.location.pathname + (search ? '?' + search : '') + window.location.hash;
  if (url !== window.location.pathname + window.location.search + window.location.hash) {
    history.replaceState(null, '', url);
  }
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

  const views = slot('views');
  views.dataset.count = String(article.viewCount || 0);
  views.textContent = viewsText(article.viewCount);

  slot('seen').hidden = !article.seen;

  // What the click handler below needs to record the view.
  node.firstElementChild.dataset.id = article.id;

  return node;
}

// Opening an article counts a view and marks it seen on this device. For now
// the card sends it on the way out, because the article page does not exist
// yet. Once it does, the page should record its own views (on the server, when
// it renders, so that a link from anywhere else counts too) and this goes, or
// every visit from the feed would count twice.
//
// keepalive, so the request survives the page being left. The card is updated
// at once rather than waiting for the answer: coming Back to the feed usually
// restores this very page from the browser's memory, not a fresh copy.
function opened(event) {
  const link = event.target.closest('h2 a');
  if (!link || !feed.contains(link)) return;
  const element = link.closest('article');

  fetch('/api/articles/' + encodeURIComponent(element.dataset.id) + '/views', { method: 'POST', keepalive: true })
    .catch(() => { /* one view lost is not worth telling the reader about */ });

  const views = element.querySelector('[data-slot="views"]');
  const count = Number(views.dataset.count) + 1;
  views.dataset.count = String(count);
  views.textContent = viewsText(count);
  element.querySelector('[data-slot="seen"]').hidden = false;
}

// click covers a normal click, Enter on the link and Ctrl+click; auxclick the
// middle button, which opens a tab without firing click.
feed.addEventListener('click', opened);
feed.addEventListener('auxclick', (event) => { if (event.button === 1) opened(event); });

// The first page replaces whatever is in the feed: placeholders, cards, the
// empty message or the error, one at a time. Each call sets every block, so no
// two can show together whatever order the answers come back in. The pieces
// that belong to later pages go back to hidden too, since a new first page
// starts the scroll again.
function show(state, articles = []) {
  feed.setAttribute('aria-busy', String(state === 'loading'));
  empty.hidden = state !== 'empty';
  failed.hidden = state !== 'error';
  moreFailed.hidden = true;
  moreBox.hidden = true;
  end.hidden = true;

  if (state === 'loading') {
    feed.replaceChildren(...Array.from({ length: SKELETONS }, () => skeletonTemplate.content.cloneNode(true)));
  } else {
    feed.replaceChildren();
    append(articles);
  }
}

const loaded = () => feed.querySelectorAll('article:not([aria-hidden])');

// role="feed" asks each article for its place in the list, and for the size of
// the list, which is not known (-1) until the last page is in.
function append(articles) {
  const start = loaded().length;
  articles.forEach((article, i) => {
    const node = card(article);
    const element = node.firstElementChild;
    element.setAttribute('aria-posinset', String(start + i + 1));
    element.setAttribute('aria-setsize', '-1');
    feed.append(node);
  });
}

// The last page is in: the size of the list is known now, and a feed with
// anything in it says that it has ended rather than just stopping.
function finished() {
  const all = loaded();
  for (const element of all) element.setAttribute('aria-setsize', String(all.length));
  end.hidden = all.length === 0;
}

// One request at a time, first page or next. A new first page cancels whatever
// is running; a next page never starts while anything is.
let inFlight = null;

// The filters of the cards on screen, and where their next page starts. Kept
// apart from the form on purpose: a search typed but not yet sent must not be
// paged with the cursor of the results it is about to replace.
let shown = null;
let cursor = null;

async function request(params, controller) {
  // Its own timer rather than AbortSignal.timeout, so that one controller
  // carries both reasons to stop and the catch can tell them apart.
  const timer = setTimeout(() => controller.abort(new DOMException('The feed took too long', 'TimeoutError')), TIMEOUT_MS);
  try {
    const response = await fetch('/api/articles?' + params, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error('The feed answered ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Every change of filter cancels the request before it. Typing "כלכלה" is five
// requests' worth of keystrokes, and without this the answer for "כלכ" could
// arrive last and replace the one the reader actually asked for.
async function load({ force = false } = {}) {
  const params = query();
  const key = params.toString();
  toAddress(params);
  // Asking again for what is already on screen (a space typed at the end of a
  // search) does not start the scroll over.
  if (!force && key === shown) return;

  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;

  shown = key;
  cursor = null;
  show('loading');
  retry.disabled = true;

  try {
    const { articles, nextCursor } = await request(params, controller);
    if (controller !== inFlight) return;
    show(articles.length ? 'cards' : 'empty', articles);
    cursor = nextCursor;
    if (!cursor) finished();
  } catch (err) {
    // Cancelled because a newer load replaced it: that load owns the screen now.
    if (controller !== inFlight) return;
    // A failure is not what the reader asked for, so asking again is allowed.
    shown = null;
    show('error');
  } finally {
    if (controller === inFlight) {
      inFlight = null;
      retry.disabled = false;
      watch();
    }
  }
}

async function loadMore() {
  // Nothing more, something already running, or the last next page failed and
  // is waiting for the reader to press retry rather than being asked again and
  // again by the observer.
  if (!cursor || inFlight || !moreFailed.hidden) return;

  const controller = new AbortController();
  inFlight = controller;

  const params = new URLSearchParams(shown);
  params.set('after', cursor);

  const placeholders = Array.from({ length: 2 }, () => skeletonTemplate.content.firstElementChild.cloneNode(true));
  feed.append(...placeholders);
  feed.setAttribute('aria-busy', 'true');
  moreRetry.disabled = true;
  // aria-disabled rather than disabled: Chrome takes focus away from a button
  // the moment it is disabled, and a keyboard reader who pressed it (or who
  // tabbed onto it and so scrolled the next page in) would be thrown back to
  // the top of the page. Pressing it meanwhile does nothing, because loadMore
  // will not start while this load runs.
  moreButton.setAttribute('aria-disabled', 'true');

  try {
    const { articles, nextCursor } = await request(params, controller);
    if (controller !== inFlight) return;
    placeholders.forEach((p) => p.remove());
    append(articles);
    cursor = nextCursor;
    if (!cursor) finished();
  } catch (err) {
    // Cancelled by a change of filter: the new first page has already cleared
    // the feed, placeholders and all.
    if (controller !== inFlight) return;
    placeholders.forEach((p) => p.remove());
    moreFailed.hidden = false;
  } finally {
    if (controller === inFlight) {
      inFlight = null;
      feed.setAttribute('aria-busy', 'false');
      moreRetry.disabled = false;
      moreButton.removeAttribute('aria-disabled');
      watch();
    }
  }
}

// Asks for the next page while the sentinel is still some way below the
// screen, so that a reader scrolling at an ordinary pace does not reach the
// bottom and wait.
//
// Without IntersectionObserver there is no scrolling in of pages at all, and
// the button below is how the feed carries on.
const observer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadMore();
  }, { rootMargin: '0px 0px 800px 0px' })
  : null;

// The observer only speaks when the sentinel crosses the line. After a page
// lands on a tall screen it can still be inside it, crossing nothing, and the
// feed would stop short. Watching it afresh makes the observer report where it
// is now, which pulls in another page if one is needed.
//
// It also settles the button: there while there is a next page to get, gone at
// the end of the feed, and gone while a failed page waits for its own retry.
function watch() {
  const more = Boolean(cursor) && moreFailed.hidden;

  // A button taken away while it has focus drops the reader back at the top of
  // the page. If it is going, focus goes where they can carry on from: the retry
  // when the page failed, the last card when the feed has ended.
  if (!more && moreBox.contains(document.activeElement)) {
    const cards = loaded();
    if (!moreFailed.hidden) moreRetry.focus();
    else if (cards.length) cards[cards.length - 1].querySelector('h2 a').focus();
  }
  moreBox.hidden = !more;
  if (!observer) return;
  observer.unobserve(sentinel);
  if (more) observer.observe(sentinel);
}

// Search waits for a pause in the typing. The selects answer at once, and cancel
// any search still waiting, since the load they start already includes it.
let typing;

form.elements.q.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(load, DEBOUNCE_MS);
});

form.addEventListener('change', (event) => {
  if (event.target === form.elements.q) return;
  clearTimeout(typing);
  load();
});

// Enter in the search box would submit the form and reload the page. It
// searches straight away instead, without waiting out the pause.
form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(typing);
  load();
});

// The button hides itself while the retry runs, which drops keyboard focus to
// the top of the page. Put it back: on the new cards if the retry worked, on
// the button again if it did not.
retry.addEventListener('click', async () => {
  await load({ force: true });
  (failed.hidden ? feed : retry).focus();
});

// The next page on request, from the button or from the retry after a failed
// one. Focus goes to the first of the new cards, which is where the reader was
// heading; if the page failed, to the retry, which is what they can do next.
async function more() {
  const before = loaded().length;
  moreFailed.hidden = true;
  await loadMore();
  const next = loaded()[before];
  if (next) next.querySelector('h2 a').focus();
  else if (!moreFailed.hidden) moreRetry.focus();
}

moreButton.addEventListener('click', more);
moreRetry.addEventListener('click', more);

fromAddress();
load();
})();
