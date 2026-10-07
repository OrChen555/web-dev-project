// Wrapped so that these names belong to this widget only. See site.js.
(() => {
const box = document.getElementById('weather');
if (!box) return;

const select = document.getElementById('weather-city');
const loading = document.getElementById('weather-loading');
const reading = document.getElementById('weather-reading');
const failed = document.getElementById('weather-error');
const retry = document.getElementById('weather-retry');
const icon = document.getElementById('weather-icon');
const temp = document.getElementById('weather-temp');
const desc = document.getElementById('weather-desc');
const time = document.getElementById('weather-time');
const stale = document.getElementById('weather-stale');
const conditions = document.getElementById('weather-conditions');

const STORAGE_KEY = 'weather-city';

// The server keeps each city for ten minutes, so asking more often only gets
// the same answer back.
const REFRESH_MS = 10 * 60 * 1000;

// The server gives up on the provider after four seconds and answers anyway,
// so a request still open after this is lost somewhere between here and there.
const TIMEOUT_MS = 8000;

// How soon to try again after a failure, when the server did not say. It rests
// the provider for a minute after one, so sooner would only get the same answer.
const RETRY_MS = 60 * 1000;

// The Hebrew description and the icon for each condition the API reports, from
// the template in the page. Anything unknown is drawn as cloudy, which is also
// what the server folds unknown codes into.
const CONDITIONS = Object.fromEntries(
  [...conditions.content.children].map((el) => [el.dataset.condition, el])
);

// Every city here is in Israel, so the time is Israel's, whatever the clock on
// the reader's computer is set to.
const ZONE = 'Asia/Jerusalem';
const AT_TIME = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: ZONE });
const AT_DAY = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ZONE });
const DAY_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE });

// "בשעה 19:30" today, "ב־25 בספטמבר בשעה 19:30" on any other day.
function when(date) {
  const today = DAY_KEY.format(new Date()) === DAY_KEY.format(date);
  return today ? 'בשעה ' + AT_TIME.format(date) : 'ב־' + AT_DAY.format(date);
}

// A browser with site data switched off still gets a working widget; it just
// forgets the city between visits.
function remembered() {
  try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
}

function remember(city) {
  try { localStorage.setItem(STORAGE_KEY, city); } catch (e) { /* not kept, still shown */ }
}

// Only a city the select actually offers. A value left over from an older
// list, or typed into the storage by hand, falls back to the default.
function startingCity() {
  const saved = remembered();
  const known = [...select.options].some((o) => o.value === saved);
  return known ? saved : select.dataset.default;
}

// One of three at a time: the placeholder, the reading, or the error.
function show(state) {
  loading.hidden = state !== 'loading';
  reading.hidden = state !== 'reading';
  failed.hidden = state !== 'error';
  box.setAttribute('aria-busy', String(state === 'loading'));
}

// Checked before it is drawn: a reading that is not a number would otherwise
// appear as "NaN°", which is worse than saying there is nothing to show.
function usable(data, city) {
  return data && data.city === city
    && typeof data.temperature === 'number' && Number.isFinite(data.temperature)
    && typeof data.condition === 'string'
    && !Number.isNaN(new Date(data.updatedAt).getTime());
}

function draw(data) {
  const condition = CONDITIONS[data.condition] || CONDITIONS.cloudy;
  icon.replaceChildren(condition.firstElementChild.cloneNode(true));
  temp.textContent = String(Math.round(data.temperature));
  desc.textContent = condition.dataset.label;

  const at = new Date(data.updatedAt);
  time.dateTime = at.toISOString();
  time.textContent = when(at);

  stale.hidden = !data.stale;
}

// What is on screen, and for which city. Kept so that a refresh that fails can
// leave the last reading up, marked as possibly old, rather than blanking it.
let shown = null;
let inFlight = null;
let timer = null;

// The next refresh. A hidden tab does not spend requests on a widget nobody is
// looking at: the refresh waits until the tab is looked at again.
let due = false;

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (document.hidden) { due = true; return; }
    load({ quietly: true });
  }, ms);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && due) {
    due = false;
    load({ quietly: true });
  }
});

// quietly: a scheduled refresh, which keeps the current reading on screen
// while it asks. Otherwise (first load, a new city, retry) the placeholder
// shows while the answer comes.
async function load({ quietly = false } = {}) {
  const city = select.value;
  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;
  const timeout = setTimeout(() => controller.abort(new DOMException('The weather took too long', 'TimeoutError')), TIMEOUT_MS);

  if (!quietly || !shown) show('loading');
  retry.disabled = true;
  let wait = RETRY_MS;

  try {
    const response = await fetch('/api/weather?city=' + encodeURIComponent(city), {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    // The server says when it will next try the provider; there is no point
    // asking before then.
    const after = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(after) && after > 0) wait = Math.max(after * 1000, 5000);

    if (!response.ok) throw new Error('The weather answered ' + response.status);
    const data = await response.json();
    if (controller !== inFlight) return;
    if (!usable(data, city)) throw new Error('The weather answered in a shape we do not recognise');

    shown = data;
    draw(data);
    show('reading');
    // A stale answer means the provider is failing; look again sooner than usual.
    schedule(data.stale ? RETRY_MS * 2 : REFRESH_MS);
  } catch (err) {
    // Replaced by a newer load, for a different city or a retry: it owns the widget.
    if (controller !== inFlight) return;

    if (shown && shown.city === city) {
      // Keep what we had, and say it may be out of date.
      stale.hidden = false;
      show('reading');
    } else {
      show('error');
    }
    schedule(wait);
  } finally {
    clearTimeout(timeout);
    if (controller === inFlight) {
      inFlight = null;
      retry.disabled = false;
    }
  }
}

select.addEventListener('change', () => {
  remember(select.value);
  shown = null;
  load();
});

// The button is hidden while the retry runs, which drops keyboard focus. Put
// it on the reading if one came back, or on the button again if it did not.
reading.tabIndex = -1;
retry.addEventListener('click', async () => {
  await load();
  (reading.hidden ? retry : reading).focus();
});

select.value = startingCity();
load();
})();
