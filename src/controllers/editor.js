const { HttpError } = require('../errors');
const Article = require('../models/article');
const { apply } = require('../services/articleState');
const newsroom = require('../services/newsroom');
const analytics = require('../services/analytics');
const { pick } = require('../services/listing');
const logger = require('../logger');

// The longest note an editor can attach when returning an article.
const MAX_NOTE = 1000;

// Formats a date for the review page, in Israel time. Used in review.ejs.
const when = (date) => (date
  ? new Date(date).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  : '');

// Turns an article document into the JSON one row of the editor's list needs.
const asRow = (article) => {
  // The working copy if there is one (that is what the editor acts on), else the live one.
  const copy = article.draft || article.published;

  return {
    id: String(article._id),
    state: article.state,
    isLive: article.isLive,
    // Live, with a rewrite waiting for approval.
    hasUpdate: article.isLive && article.draftStatus === 'pending',
    category: article.category,
    title: copy.title,
    // The headline readers see now, only when the rewrite changed it.
    liveTitle: article.draft && article.published && article.published.title !== article.draft.title
      ? article.published.title
      : null,
    summary: copy.summary,
    image: copy.image || null,
    reporter: article.reporter && { id: article.reporter._id, name: article.reporter.name },
    updatedAt: article.updatedAt,
    publishedAt: article.publishedAt,
    viewCount: article.viewCount,
    commentCount: article.commentCount,
    editorNote: article.editorNote ? { text: article.editorNote.text, at: article.editorNote.at } : null
  };
};

// GET /api/articles?all=true. The editor's list, as JSON (called by editor-list.js).
async function list(req, res) {
  const { articles, nextCursor } = await newsroom.list(req.query);

  res.json({ articles: articles.map(asRow), nextCursor });
}

// POST /api/articles/:id/approve. Publishes the working copy (the "approve" button).
async function approve(req, res) {
  const article = req.target;
  // Remembered before approving, so the log can say "update" or "first publication".
  const wasLive = article.isLive;

  // The state machine checks the role and state, then publishes the working copy.
  apply(article, 'approve', req.user);
  await article.save();

  logger.info(wasLive ? 'update published' : 'article published', {
    by: req.user.username,
    article: String(article._id),
    publications: article.publishHistory.length
  });

  // Answers with the updated row, so the page can redraw it without reloading.
  res.json(asRow(await article.populate('reporter', 'name')));
}

// POST /api/articles/:id/return. Sends it back to the reporter with a note.
async function sendBack(req, res) {
  const article = req.target;

  // Check the note ourselves: it comes straight from the request body.
  if (req.body.note !== undefined && typeof req.body.note !== 'string') {
    throw new HttpError(400, 'The note has to be text');
  }
  if (String(req.body.note || '').trim().length > MAX_NOTE) {
    throw new HttpError(400, `The note is longer than ${MAX_NOTE} characters`);
  }

  apply(article, 'return', req.user, req.body.note);
  await article.save();

  logger.info('article returned', { by: req.user.username, article: String(article._id) });

  res.json(asRow(await article.populate('reporter', 'name')));
}

// DELETE /api/articles/:id. Deletes the article with its comments and views.
async function remove(req, res) {
  const article = req.target;
  // Read before deleting, so the log still knows what was removed.
  const title = (article.published || article.draft || {}).title;

  await newsroom.remove(article);

  logger.info('article deleted', { by: req.user.username, article: String(article._id), title });

  res.status(204).end();
}

// GET /api/articles/:id/views?range=7d. The chart data (called by editor-analytics.js).
async function views(req, res) {
  const article = req.target;
  // Swap each approver's id for their name.
  await article.populate('publishHistory.by', 'name');

  // Only a known range is accepted; anything else is a 400.
  const range = pick(req.query.range, analytics.RANGES, 'range') || 'all';

  // The live headline first, since the chart is about what readers saw.
  const copy = article.published || article.draft;

  res.json({
    article: {
      id: String(article._id),
      title: copy.title,
      category: article.category,
      publishedAt: article.publishedAt,
      viewCount: article.viewCount
    },
    // The chart fields themselves (buckets, publications, impact...) spread in here.
    ...(await analytics.series(article, range))
  });
}

// GET /api/analytics/overview?range=7d. The whole-site dashboard (called by editor-analytics.js).
async function overview(req, res) {
  // Same check as views(); the dashboard defaults to the last week.
  const range = pick(req.query.range, analytics.RANGES, 'range') || '7d';

  res.json(await analytics.overview(range));
}

// GET /editor/articles. Renders the list page; editor-list.js then fills it.
function queuePage(req, res) {
  res.render('editor/list', {
    title: 'אזור העורך',
    script: '/js/editor-list.js',
    categories: Article.CATEGORIES,
    // The filter to open on, from ?status=. Pending is the default: that is the editor's to-do list.
    status: [...newsroom.FILTERS, 'all'].includes(req.query.status) ? req.query.status : 'pending'
  });
}

// Splits a body into paragraphs for review.ejs.
const paragraphs = (copy) => (copy ? copy.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : []);

// GET /editor/articles/:id. Renders the review page with both versions in the HTML.
async function reviewPage(req, res) {
  const article = await Article.findById(req.params.id)
    // Names instead of ids for the reporter, the note's author and every approver.
    .populate('reporter', 'name')
    .populate('editorNote.by', 'name')
    .populate('publishHistory.by', 'name');
  if (!article) throw new HttpError(404, 'No such article');

  // ?done= is set after approve/return, so the page can show a "done" message.
  const done = ['approved', 'returned'].includes(req.query.done) ? req.query.done : null;

  res.render('editor/review', {
    title: 'סקירת כתבה',
    script: '/js/editor-review.js',
    article,
    when,
    paragraphs,
    done
  });
}

// GET /editor/analytics. Renders the chart page; editor-analytics.js then fills it.
function analyticsPage(req, res) {
  res.render('editor/analytics', {
    title: 'סטטיסטיקות',
    // Chart.js loads before the page script, which needs the Chart global.
    scripts: ['/vendor/chart.js/chart.umd.min.js'],
    script: '/js/editor-analytics.js',
    // ?article=<id> opens the page straight on that article's report.
    selected: typeof req.query.article === 'string' ? req.query.article : ''
  });
}

module.exports = { list, approve, sendBack, remove, views, overview, queuePage, reviewPage, analyticsPage };
