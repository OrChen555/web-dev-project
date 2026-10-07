const config = require('../config');
const logger = require('../logger');
const { HttpError } = require('../errors');

// The current weather for the widget on the home page, from Open-Meteo.
//
// Every reader's page asks for this, so readers never wait on the provider.
// The server fetches all the cities itself, in one request, when it starts and
// every ten minutes after that, and a reader is answered from memory. A slow or
// failing provider then costs a reader nothing: they get the last reading, and
// the next attempt happens in the background, not inside their request.

// A fixed list rather than any name a stranger types: each entry is a request
// to somebody else's service, and a free-text city would let anyone make us
// send as many as they like. The keys are English and stable, like the
// categories; what a reader sees is Hebrew and belongs to the view.
const CITIES = Object.freeze({
  'tel-aviv': { latitude: 32.0853, longitude: 34.7818 },
  jerusalem: { latitude: 31.7683, longitude: 35.2137 },
  haifa: { latitude: 32.7940, longitude: 34.9896 },
  'beer-sheva': { latitude: 31.2520, longitude: 34.7915 },
  eilat: { latitude: 29.5577, longitude: 34.9519 }
});

const KEYS = Object.keys(CITIES);
const DEFAULT_CITY = 'tel-aviv';

// Open-Meteo itself refreshes current conditions every fifteen minutes, so
// asking more often than this would mostly fetch the same numbers again.
const REFRESH_MS = 10 * 60 * 1000;

// After a failure, try again in a minute rather than waiting out the full ten.
const RETRY_MS = 60 * 1000;

// Short, and tried again, rather than long. Measured from here, a healthy
// answer takes 0.3 to 0.5 seconds, but about one new connection in five never
// finishes its TLS handshake and is reset after ten seconds; curl sees the same,
// so it is the network, not us. Waiting longer only waits for the reset. Three
// quick attempts all stalling is about one refresh in a hundred, and even then
// readers keep the last reading.
const TIMEOUT_MS = 2500;
const ATTEMPTS = 3;

// The requirement allows the weather to lag by fifteen minutes. A reading older
// than that is still shown, but flagged, so the widget can say so.
const FRESH_MS = 15 * 60 * 1000;

// Three hours on, the weather a reading describes is simply wrong, and saying
// nothing is more honest.
const STALE_LIMIT_MS = 3 * 60 * 60 * 1000;

// WMO weather codes, which is what Open-Meteo reports, folded into the handful
// of conditions the widget draws. Anything not listed reads as cloudy.
// https://open-meteo.com/en/docs (the "WMO Weather interpretation codes" table)
function condition(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunderstorm';
  return 'cloudy';
}

// Somebody else's service, so its answer is checked rather than trusted: a
// changed format should fail here, loudly, not reach the page as NaN.
function readingFrom(city, place) {
  const current = place && place.current;
  const temperature = current && current.temperature_2m;
  const code = current && current.weather_code;
  // Given in UTC, because we asked for it, but without the Z that says so.
  const at = current && typeof current.time === 'string' ? new Date(current.time + 'Z') : null;

  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || !Number.isInteger(code) || !at || Number.isNaN(at.getTime())) {
    throw new Error('Open-Meteo answered in a shape we do not recognise');
  }

  return { city, temperature: Math.round(temperature), condition: condition(code), updatedAt: at.toISOString() };
}

// Every city in one request: Open-Meteo takes comma separated coordinates and
// answers with one entry per place, in the same order.
async function fetchAll() {
  const url = new URL(config.weatherUrl);
  url.search = new URLSearchParams({
    latitude: KEYS.map((key) => CITIES[key].latitude).join(','),
    longitude: KEYS.map((key) => CITIES[key].longitude).join(','),
    current: 'temperature_2m,weather_code',
    timezone: 'UTC'
  });

  const started = Date.now();
  const response = await attempt(url);
  if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);

  const places = await response.json();
  if (!Array.isArray(places) || places.length !== KEYS.length) {
    throw new Error('Open-Meteo answered in a shape we do not recognise');
  }

  const fresh = new Map(KEYS.map((key, i) => [key, readingFrom(key, places[i])]));
  logger.info('weather fetched', { cities: KEYS.length, ms: Date.now() - started });
  return fresh;
}

// fetch reports a reset connection as a bare 'fetch failed', with the reason
// underneath it.
const why = (err) => (err.name === 'TimeoutError' ? 'timed out' : (err.cause && err.cause.code) || err.message);

// Only a connection that failed or stalled is tried again. An answer, even a
// 500, is the provider speaking, and asking it twice more at once will not help.
async function attempt(url) {
  for (let n = 1; ; n++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      if (n === ATTEMPTS) throw err;
      logger.info('weather attempt failed, trying again', { attempt: n, reason: why(err) });
    }
  }
}

// The last good readings and when they arrived, the request under way if there
// is one, and when the provider may next be asked.
let readings = null;
let fetchedAt = 0;
let inFlight = null;
let nextTry = 0;
let timer = null;

const usable = () => Boolean(readings) && Date.now() - fetchedAt < STALE_LIMIT_MS;

// The background loop. unref, so a pending refresh never keeps the process
// alive on its own.
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(refresh, Math.max(0, nextTry - Date.now()));
  timer.unref();
}

// Shared: whoever asks while a request is running gets that same request, so
// there is never more than one open to the provider. It never rejects; a
// failure is logged once here and the next attempt is scheduled.
function refresh() {
  if (!inFlight) {
    inFlight = fetchAll()
      .then((fresh) => {
        readings = fresh;
        fetchedAt = Date.now();
        nextTry = fetchedAt + REFRESH_MS;
      })
      .catch((err) => {
        nextTry = Date.now() + RETRY_MS;
        // With something to fall back on the widget still works, so that is a
        // warning; with nothing it goes blank, and that is an error.
        const fallback = usable() ? 'stale' : 'none';
        logger[fallback === 'stale' ? 'warn' : 'error']('weather fetch failed', { reason: why(err), fallback });
      })
      .finally(() => {
        inFlight = null;
        schedule();
      });
  }
  return inFlight;
}

// Called once the server is listening, so the first reader finds the weather
// already there.
function start() {
  refresh();
}

function pickCity(value) {
  if (value === undefined || value === '') return DEFAULT_CITY;
  if (typeof value !== 'string' || !Object.hasOwn(CITIES, value)) {
    throw new HttpError(400, `There is no such city as "${String(value)}"`);
  }
  return value;
}

async function current(asked) {
  const city = pickCity(asked);

  // Nothing yet: the first reader after a start, or the provider has been down
  // since. Wait for the request already running, or start one if the provider
  // is not resting after a failure. This is the only path a reader waits on.
  if (!usable()) {
    if (inFlight) await inFlight;
    else if (Date.now() >= nextTry) await refresh();
  }

  // Returned rather than thrown: the failure behind it was logged once, in
  // refresh(), and a throw would have the error middleware log it again, with a
  // stack, for every reader who asks during the outage.
  if (!usable()) return null;
  return { ...readings.get(city), stale: Date.now() - fetchedAt > FRESH_MS };
}

// When the weather is worth asking about again, after it was not available.
const retryAfterSeconds = () => Math.max(1, Math.ceil((nextTry - Date.now()) / 1000));

module.exports = { start, current, retryAfterSeconds, CITIES: KEYS, DEFAULT_CITY };
