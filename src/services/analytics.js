const Article = require('../models/article');
const ViewBucket = require('../models/viewBucket');

// The series behind the Impact Analytics chart: views over time for one
// article, and the moments an editor put an update in front of readers.
//
// Views are stored in fifteen minute buckets (see models/viewBucket.js). That is
// the right size for a day, and far too fine for a month: 2,880 points is more
// than a chart a few hundred pixels wide can draw. So the window widens with the
// range, and the browser always receives a few hundred points at most.

// Time units in milliseconds, which is what Date math uses.
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// The ranges the page offers, as how far back each one reaches. null means "since the start".
const RANGES = {
  '24h': 24 * HOUR,
  '7d': 7 * 24 * HOUR,
  '30d': 30 * 24 * HOUR,
  all: null
};

// Every one is a whole number of fifteen minute buckets, so a wider window is
// always a sum of complete stored ones and never splits one in two.
const STEPS = [15, 30, 60, 120, 180, 360, 720, 1440];
// The most points one chart line gets, whatever the range.
const MAX_POINTS = 400;

// How far either side of an update the before and after comparison looks.
const IMPACT_HOURS = 24;

// The narrowest window that keeps the chart under MAX_POINTS.
function stepFor(span) {
  const minutes = STEPS.find((m) => span / (m * MINUTE) <= MAX_POINTS) || STEPS[STEPS.length - 1];
  return minutes * MINUTE;
}

// One article's chart data for a range: views per window, its publications, and before/after numbers.
async function series(article, range) {
  const now = new Date();

  // The end is the close of the current bucket, so the views counted in the last
  // few minutes are on the chart rather than waiting for the window to finish.
  const end = ViewBucket.windowFor(now).getTime() + ViewBucket.WINDOW_MINUTES * MINUTE;

  // The whole life of the article starts at its first publication. Nothing can
  // be viewed before that.
  const born = article.publishHistory.length ? article.publishHistory[0].at : article.createdAt;
  const wanted = RANGES[range] ? end - RANGES[range] : new Date(born).getTime() - HOUR;

  // Pick the window size, then round the start down so every window lines up on it.
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
    // Buckets before the chart start were only read for the "before" numbers.
    if (time < start) continue;
    // Which window this bucket belongs to, by how many steps it is past the start.
    buckets[Math.floor((time - start) / step)].count += row.count;
    total += row.count;
  }

  // Total views between two times, from the buckets already read (no extra query).
  const sumBetween = (from, to) => stored
    .filter((row) => row.bucket.getTime() >= from && row.bucket.getTime() < to)
    .reduce((sum, row) => sum + row.count, 0);

  // Every approval of this article that falls inside the chart. The first one is the original publication.
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
    // A recent update has had less than a full day; divide by the hours it really had.
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

  // The JSON the browser draws from (see editor-analytics.js).
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

// How many articles the dashboard's "most viewed" table lists.
const TOP = 10;

// Sums every view between two times, across all articles.
async function sumAll(from, to) {
  const [row] = await ViewBucket.aggregate([
    // Keep only the buckets in the time range.
    { $match: { bucket: { $gte: new Date(from), $lt: new Date(to) } } },
    // Add them all into one row (_id: null means "one group for everything").
    { $group: { _id: null, count: { $sum: '$count' } } }
  ]);
  return row ? row.count : 0;
}

// The dashboard: the whole site at once, not one article. Every sum is done
// inside mongo, so the server never loads the view buckets themselves.
async function overview(range) {
  const now = new Date();
  // The end of the current 15 minute bucket, same as in series().
  const end = ViewBucket.windowFor(now).getTime() + ViewBucket.WINDOW_MINUTES * MINUTE;

  // "All" starts at the oldest view on record (or an hour ago on an empty site).
  let wanted = RANGES[range] ? end - RANGES[range] : null;
  if (wanted === null) {
    const oldest = await ViewBucket.findOne().sort({ bucket: 1 }).lean();
    wanted = oldest ? oldest.bucket.getTime() : end - HOUR;
  }

  const step = stepFor(end - wanted);
  const start = Math.floor(wanted / step) * step;
  // The filter every query below shares: buckets inside the chart's time range.
  const inRange = { bucket: { $gte: new Date(start), $lt: new Date(end) } };

  // Views over time for the whole site: each stored bucket goes into its window by index.
  // Not awaited yet: the four queries start now and run side by side (see Promise.all below).
  const timeline = ViewBucket.aggregate([
    { $match: inRange },
    // _id = window number: (bucket time - start) / step, rounded down.
    { $group: { _id: { $floor: { $divide: [{ $subtract: ['$bucket', new Date(start)] }, step] } }, count: { $sum: '$count' } } }
  ]);

  // Views per article in the range. The top table and the categories are both built from it.
  const perArticle = ViewBucket.aggregate([
    { $match: inRange },
    // One row per article, with its views added up.
    { $group: { _id: '$article', views: { $sum: '$count' } } }
  ]);

  // Every approval in the range, split into first publications and updates.
  const approvals = Article.aggregate([
    // One row per approval instead of one per article; n is its place in the history (0 = first).
    { $unwind: { path: '$publishHistory', includeArrayIndex: 'n' } },
    // Only approvals inside the range.
    { $match: { 'publishHistory.at': { $gte: new Date(start), $lt: new Date(end) } } },
    // Two groups: _id false = first publications, _id true = later updates.
    { $group: { _id: { $gt: ['$n', 0] }, count: { $sum: 1 } } }
  ]);

  // The same length of time just before this one, to say whether views went up or down.
  const previous = RANGES[range] ? sumAll(start - (end - start), start) : null;

  // Wait for all the queries together. live = how many articles readers can see right now.
  const [windows, articles, approved, before, live] = await Promise.all([
    timeline, perArticle, approvals, previous, Article.countDocuments({ published: { $ne: null } })
  ]);

  // Fill every window, so a quiet hour is a zero on the chart rather than a gap.
  const buckets = [];
  for (let at = start; at < end; at += step) buckets.push({ at: new Date(at), count: 0 });
  for (const row of windows) if (buckets[row._id]) buckets[row._id].count = row.count;

  // Total views in the range, from the per-article sums.
  const total = articles.reduce((sum, row) => sum + row.views, 0);

  // Titles and categories for every article that was viewed, read in one query.
  const found = await Article.find({ _id: { $in: articles.map((row) => row._id) } })
    .select('category published.title draft.title viewCount')
    .lean();
  // Lookup by id, so each per-article row can find its article quickly.
  const byId = new Map(found.map((a) => [String(a._id), a]));

  // Adds the views of each article into its category's total.
  const categories = Object.fromEntries(Article.CATEGORIES.map((c) => [c, 0]));
  for (const row of articles) {
    const article = byId.get(String(row._id));
    if (article) categories[article.category] += row.views;
  }

  // The most viewed articles in the range, with their share of all the views.
  // Only ids found above: an article deleted mid-request has no title to show.
  const top = articles
    .filter((row) => byId.has(String(row._id)))
    .sort((a, b) => b.views - a.views)
    .slice(0, TOP)
    .map((row) => {
      const article = byId.get(String(row._id));
      return {
        id: String(row._id),
        title: (article.published || article.draft).title,
        category: article.category,
        views: row.views,
        share: total ? row.views / total : 0,
        viewCount: article.viewCount
      };
    });

  // Reads one of the two approval groups; missing means zero.
  const count = (later) => (approved.find((row) => row._id === later) || { count: 0 }).count;

  return {
    range,
    from: new Date(start),
    to: new Date(end),
    stepMinutes: step / MINUTE,
    total,
    previousTotal: before,
    live,
    viewed: articles.length,
    published: count(false),
    updates: count(true),
    buckets,
    top,
    // An array in the fixed category order, so the browser can sort it as it likes.
    categories: Article.CATEGORIES.map((category) => ({ category, views: categories[category] }))
  };
}

module.exports = { series, overview, RANGES: Object.keys(RANGES) };
