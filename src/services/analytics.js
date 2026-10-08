const ViewBucket = require('../models/viewBucket');

// The series behind the Impact Analytics chart: views over time for one
// article, and the moments an editor put an update in front of readers.
//
// Views are stored in fifteen minute buckets (see models/viewBucket.js). That is
// the right size for a day, and far too fine for a month: 2,880 points is more
// than a chart a few hundred pixels wide can draw. So the window widens with the
// range, and the browser always receives a few hundred points at most.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const RANGES = {
  '24h': 24 * HOUR,
  '7d': 7 * 24 * HOUR,
  '30d': 30 * 24 * HOUR,
  all: null
};

// Every one is a whole number of fifteen minute buckets, so a wider window is
// always a sum of complete stored ones and never splits one in two.
const STEPS = [15, 30, 60, 120, 180, 360, 720, 1440];
const MAX_POINTS = 400;

// How far either side of an update the before and after comparison looks.
const IMPACT_HOURS = 24;

// The narrowest window that keeps the chart under MAX_POINTS.
function stepFor(span) {
  const minutes = STEPS.find((m) => span / (m * MINUTE) <= MAX_POINTS) || STEPS[STEPS.length - 1];
  return minutes * MINUTE;
}

async function series(article, range = 'all', now = new Date()) {
  if (!(range in RANGES)) range = 'all';

  // The end is the close of the current bucket, so the views counted in the last
  // few minutes are on the chart rather than waiting for the window to finish.
  const end = ViewBucket.windowFor(now).getTime() + ViewBucket.WINDOW_MINUTES * MINUTE;

  // The whole life of the article starts at its first publication. Nothing can
  // be viewed before that.
  const born = article.publishHistory.length ? article.publishHistory[0].at : article.createdAt;
  const wanted = RANGES[range] ? end - RANGES[range] : new Date(born).getTime() - HOUR;

  const step = stepFor(end - wanted);
  const start = Math.floor(wanted / step) * step;

  // One read of the stored buckets, reaching a day further back than the chart
  // so the "before" of an update near its start can be counted too. A month of
  // one article is at most a few thousand small documents.
  const stored = await ViewBucket.find({
    article: article._id,
    bucket: { $gte: new Date(start - IMPACT_HOURS * HOUR), $lt: new Date(end) }
  }).lean();

  // Add each stored bucket into the chart window it falls in. A window nobody
  // opened the article in starts at zero and stays zero, so the line drops to
  // the floor over a quiet night instead of jumping across it.
  const buckets = [];
  for (let at = start; at < end; at += step) buckets.push({ at: new Date(at), count: 0 });

  let total = 0;
  for (const row of stored) {
    const time = row.bucket.getTime();
    if (time < start) continue;
    buckets[Math.floor((time - start) / step)].count += row.count;
    total += row.count;
  }

  const sumBetween = (from, to) => stored
    .filter((row) => row.bucket.getTime() >= from && row.bucket.getTime() < to)
    .reduce((sum, row) => sum + row.count, 0);

  const publications = article.publishHistory
    .map((entry, index) => ({
      at: entry.at,
      by: entry.by && entry.by.name ? entry.by.name : null,
      first: index === 0
    }))
    .filter((entry) => entry.at.getTime() >= start && entry.at.getTime() < end);

  // The question the chart is asked: did the update change anything. Answered in
  // numbers as well as in the line, a day either side, and per hour so that an
  // update made this morning is not penalised for having had less time.
  const window = IMPACT_HOURS * HOUR;
  const impact = publications.map((entry) => {
    const at = entry.at.getTime();
    const hoursAfter = Math.min(window, now.getTime() - at) / HOUR;
    const before = sumBetween(at - window, at);
    const after = sumBetween(at, at + window);

    return {
      at: entry.at,
      first: entry.first,
      before,
      after,
      beforeRate: before / IMPACT_HOURS,
      afterRate: hoursAfter > 0 ? after / hoursAfter : 0
    };
  });

  return {
    range,
    from: new Date(start),
    to: new Date(end),
    stepMinutes: step / MINUTE,
    total,
    buckets,
    publications,
    impact,
    impactHours: IMPACT_HOURS
  };
}

module.exports = { series, RANGES: Object.keys(RANGES) };
