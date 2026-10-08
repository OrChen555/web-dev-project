const { HttpError } = require('../errors');
const Article = require('../models/article');
const { apply } = require('../services/articleState');
const newsroom = require('../services/newsroom');
const analytics = require('../services/analytics');
const logger = require('../logger');

const MAX_NOTE = 1000;

// What the pages print. Hebrew lives in the views, the enum stays English.
const CATEGORY_NAMES = {
  news: 'חדשות',
  politics: 'פוליטיקה',
  economy: 'כלכלה',
  sports: 'ספורט',
  culture: 'תרבות',
  technology: 'טכנולוגיה',
  health: 'בריאות'
};

// The server formats in Israel's time zone whatever the machine it runs on is
// set to, so the page says the same thing on the lecturer's laptop as on ours.
const when = (date) => (date
  ? new Date(date).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  : '');

// One row of the editor's list. The title is the working copy's where there is
// one, because that is what is waiting on the editor; isLive and hasUpdate say
// whether readers are meanwhile seeing something else.
const asRow = (article) => {
  const copy = article.draft || article.published;

  return {
    id: String(article._id),
    state: article.state,
    isLive: article.isLive,
    hasUpdate: article.isLive && article.draftStatus === 'pending',
    category: article.category,
    title: copy.title,
    // What readers see, when a rewrite has changed the headline. Search matches
    // either, so without it a row could match on a title it does not show.
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

async function list(req, res) {
  const { articles, nextCursor } = await newsroom.list({
    status: req.query.status ? String(req.query.status) : '',
    category: req.query.category ? String(req.query.category) : '',
    q: req.query.q ? String(req.query.q) : '',
    sort: req.query.sort ? String(req.query.sort) : '',
    after: req.query.after ? String(req.query.after) : '',
    limit: req.query.limit
  });

  res.json({ articles: articles.map(asRow), nextCursor });
}

// Both go through the state machine, which is what refuses an approval of
// something that is not pending, or a return without a note. Nothing here sets
// draftStatus itself.
async function approve(req, res) {
  const article = req.target;
  const wasLive = article.isLive;

  apply(article, 'approve', req.user);
  await article.save();

  logger.info(wasLive ? 'update published' : 'article published', {
    by: req.user.username,
    article: String(article._id),
    publications: article.publishHistory.length
  });

  res.json(asRow(await article.populate('reporter', 'name')));
}

async function sendBack(req, res) {
  const article = req.target;

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

async function remove(req, res) {
  const article = req.target;
  const title = (article.published || article.draft || {}).title;

  await newsroom.remove(article);

  logger.info('article deleted', { by: req.user.username, article: String(article._id), title });

  res.status(204).end();
}

async function views(req, res) {
  const article = req.target;
  await article.populate('publishHistory.by', 'name');

  const range = String(req.query.range || 'all');
  if (!analytics.RANGES.includes(range)) {
    throw new HttpError(400, `Range must be one of: ${analytics.RANGES.join(', ')}`);
  }

  const copy = article.published || article.draft;

  res.json({
    article: {
      id: String(article._id),
      title: copy.title,
      category: article.category,
      publishedAt: article.publishedAt,
      viewCount: article.viewCount
    },
    ...(await analytics.series(article, range))
  });
}

// The pages. The queue and the chart fill themselves from the endpoints above;
// the review page is rendered whole, so the editor reads both versions in the
// HTML itself and the script only adds the highlighting and the buttons.

function queuePage(req, res) {
  res.render('editor/list', {
    title: 'אזור העורך',
    script: '/js/editor-list.js',
    filters: newsroom.FILTERS,
    categories: Article.CATEGORIES,
    names: CATEGORY_NAMES,
    // The queue opens on what is waiting, because that is what the editor is
    // here for. "all" is spelled out so the choice survives in the address bar.
    status: [...newsroom.FILTERS, 'all'].includes(req.query.status) ? req.query.status : 'pending'
  });
}

// The two copies split into paragraphs here, so the template only loops.
const paragraphs = (copy) => (copy ? copy.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : []);

async function reviewPage(req, res) {
  const article = await Article.findById(req.params.id)
    .populate('reporter', 'name')
    .populate('editorNote.by', 'name')
    .populate('publishHistory.by', 'name');
  if (!article) throw new HttpError(404, 'No such article');

  // Only ever one of these, and only after this page did it: the result of the
  // action that reloaded it.
  const done = ['approved', 'returned'].includes(req.query.done) ? req.query.done : null;

  res.render('editor/review', {
    title: 'סקירת כתבה',
    script: '/js/editor-review.js',
    article,
    names: CATEGORY_NAMES,
    when,
    paragraphs,
    done
  });
}

function analyticsPage(req, res) {
  res.render('editor/analytics', {
    title: 'סטטיסטיקות',
    scripts: ['/vendor/chart.js/chart.umd.min.js'],
    script: '/js/editor-analytics.js',
    selected: typeof req.query.article === 'string' ? req.query.article : ''
  });
}

module.exports = { list, approve, sendBack, remove, views, queuePage, reviewPage, analyticsPage };
