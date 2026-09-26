const config = require('../config');
const logger = require('../logger');
const { HttpError } = require('../errors');

// The current weather for the widget on the home page, from Open-Meteo.
//
// Every reader's page asks for this, so the provider must not be. One answer per
// city is kept for ten minutes and handed to everybody; while it is being
// fetched, anyone else asking for the same city waits on that same request
// rather than starting their own; and when the provider fails, the last answer
// is served, marked stale, rather than breaking the widget.

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

const DEFAULT_CITY = 'tel-aviv';

// Open-Meteo itself refreshes current conditions every fifteen minutes, so
// asking more often than this would mostly fetch the same numbers again.
const FRESH_MS = 10 * 60 * 1000;

// Long enough for a slow answer, short enough that a hung one does not hold a
// reader's request open. The widget is a sidebar, not the page.
const TIMEOUT_MS = 4000;

// After a failure the provider is left alone for a minute. Without this, every
// request during an outage would wait out the full timeout before falling back.
const RETRY_AFTER_MS = 60 * 1000;

// A stale reading is better than none, up to a point. Three hours on, the
// weather it describes is simply wrong, and saying nothing is more honest.
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

// Per city: the last good reading and when we got it, the request under way if
// there is one, and when we may next try after a failure.
const cache = new Map();
const inFlight = new Map();
const resting = new Map();

async function fetchCity(city) {
  const { latitude, longitude } = CITIES[city];
  const url = new URL(config.weatherUrl);
  url.search = new URLSearchParams({
    latitude, longitude, current: 'temperature_2m,weather_code', timezone: 'UTC'
  });

  const started = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);

  // Somebody else's service, so its answer is checked rather than trusted: a
  // changed format should fail here, loudly, not reach the page as NaN.
  const body = await response.json();
  const current = body && body.current;
  const temperature = current && current.temperature_2m;
  const code = current && current.weather_code;
  // Given in UTC, because we asked for it, but without the Z that says so.
  const at = current && typeof current.time === 'string' ? new Date(current.time + 'Z') : null;

  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || !Number.isInteger(code) || !at || Number.isNaN(at.getTime())) {
    throw new Error('Open-Meteo answered in a shape we do not recognise');
  }

  logger.info('weather fetched', { city, ms: Date.now() - started });

  return {
    city,
    temperature: Math.round(temperature),
    condition: condition(code),
    updatedAt: at.toISOString()
  };
}

// The request for a city, shared. The first caller starts it; everyone who
// asks before it settles gets the same promise, so a hundred readers arriving
// at once are one request to Open-Meteo, not a hundred. The outcome is logged
// here, once per request, rather than once per reader who was waiting on it.
function refresh(city) {
  if (!inFlight.has(city)) {
    const request = fetchCity(city)
      .then((reading) => {
        cache.set(city, { reading, fetchedAt: Date.now() });
        resting.delete(city);
        return reading;
      })
      .catch((err) => {
        resting.set(city, Date.now() + RETRY_AFTER_MS);
        const fallback = usable(cache.get(city)) ? 'stale' : 'none';
        const reason = err.name === 'TimeoutError' ? 'timed out' : err.message;
        // A stale answer still reaches the reader, so that is a warning; with
        // nothing to fall back on the widget goes blank, and that is an error.
        logger[fallback === 'stale' ? 'warn' : 'error']('weather fetch failed', { city, reason, fallback });
        throw err;
      })
      .finally(() => inFlight.delete(city));
    inFlight.set(city, request);
  }
  return inFlight.get(city);
}

const usable = (cached) => Boolean(cached) && Date.now() - cached.fetchedAt < STALE_LIMIT_MS;

function pickCity(value) {
  if (value === undefined || value === '') return DEFAULT_CITY;
  if (typeof value !== 'string' || !Object.hasOwn(CITIES, value)) {
    throw new HttpError(400, `There is no such city as "${String(value)}"`);
  }
  return value;
}

async function current(asked) {
  const city = pickCity(asked);
  const cached = cache.get(city);

  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return { ...cached.reading, stale: false };

  // Old or missing, and the provider has not failed in the last minute: ask it.
  // If it failed a moment ago, do not wait on it again yet.
  if (!(resting.get(city) > Date.now())) {
    try {
      return { ...(await refresh(city)), stale: false };
    } catch (err) {
      // Logged in refresh(). Fall through to whatever we still have.
    }
  }

  if (usable(cached)) return { ...cached.reading, stale: true };

  // Nothing to show. Returned rather than thrown: the failure behind it was
  // logged once, in refresh(), and a throw would have the error middleware log
  // it again, with a stack, for every reader who asks during the outage.
  return null;
}

// When a city whose weather is unavailable is worth asking about again.
const retryAfterSeconds = (city) => Math.max(1, Math.ceil(((resting.get(pickCity(city)) || 0) - Date.now()) / 1000));

module.exports = { current, retryAfterSeconds, CITIES: Object.keys(CITIES), DEFAULT_CITY };
