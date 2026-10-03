const { HttpError } = require('../errors');
const Article = require('../models/article');
const feed = require('../services/feed');
const views = require('../services/views');
const { apply, mayEdit, isEditor } = require('../services/articleState');
const logger = require('../logger');

// What the feed shows for one article. Kept in one place so the card and the
// article page cannot drift apart.
const asCard = (article) => ({
  id: article._id,
  title: article.published.title,
  summary: article.published.summary,
  image: article.published.image || null,
  category: article.category,
  reporter: article.reporter && { id: article.reporter._id, name: article.reporter.name },
  publishedAt: article.publishedAt,
  viewCount: article.viewCount,
  commentCount: article.commentCount
});

//asCard for the draft article. (no publishedAt, viewCount, commentCount )
const asDraft = (article) => {
  const copy = article.draft || article.published;

  return {
    id: String(article._id),
    state: article.state,
    category: article.category,
    title: copy.title,
    summary: copy.summary,
    body: copy.body,
    image: copy.image || null,

    // Why it came back. Without it a returned article cannot explain itself, and
    // the reporter would need a second request to find out.
    editorNote: article.editorNote || null
  };
};

// Picked out one at a time. reporter and draftStatus are missing on purpose: 
// a field that is never read cannot be forged.
const readBody = (body) => ({
  category: String(body.category || ''),
  title: String(body.title || '').trim(),
  summary: String(body.summary || '').trim(),
  body: String(body.body || '').trim(),
  image: String(body.image || '').trim()
});

// The four the autosave may write. category is missing on purpose: it lives on
// the article, not the version, so both copies share one.
const DRAFT_FIELDS = ['title', 'summary', 'body', 'image'];

async function list(req, res) {
  // The same URL answers two questions: the public feed, and a reporter asking
  // for their own work. The guard is here rather than on the route because
  // without the flag this endpoint is public.
  if (req.query.mine === 'true') {
    if (!req.user) throw new HttpError(401, 'You are not signed in');

    const { articles, nextCursor } = await feed.mine(req.query, req.user._id);

    // updatedAt is what a reporter's list sorts by, and asDraft does not carry it.
    const rows = articles.map((article) => ({ ...asDraft(article), updatedAt: article.updatedAt }));

    return res.json({ articles: rows, nextCursor });
  }

  const { articles, seen, nextCursor } = await feed.page(req.query, req.visitorId);

  // The article page leaves this off: by the time a reader is on it, it is seen.
  const cards = articles.map((article) => ({ ...asCard(article), seen: seen.has(String(article._id)) }));

  // Never kept by the browser. The answer is this device's own (the seen flags)
  // and changes with every view, and on Back the browser reuses a cached answer
  // without asking, so a reader returning from an article saw it still unread.
  res.set('Cache-Control', 'no-store');
  res.json({ articles: cards, nextCursor });
}

async function one(req, res) {
  const article = await Article.findById(req.params.id).populate('reporter', 'name');
  if (!article) throw new HttpError(404, 'No such article');

  if (req.user && mayEdit(article, req.user)) {
    return res.json({
      ...asDraft(article),
      published: article.published,
      draft: article.draft
    });
  }

  // An article that has never been approved does not exist as far as a reader
  // is concerned, and saying "not published yet" would confirm that it exists.
  if (!article.published) throw new HttpError(404, 'No such article');

  res.json({
    ...asCard(article),
    body: article.published.body
  });
}

// Counts one view by this device. Answers with nothing, since the page that
// sends it has already moved on.
async function view(req, res) {
  if (!(await views.record(req.params.id, req.visitorId))) throw new HttpError(404, 'No such article');
  res.status(204).end();
}

// Validates what the reporter typed and creates the article as a draft. 
async function create(req, res) {
  const { category, title, summary, body, image } = readBody(req.body);

  if (!title || !summary || !body) throw new HttpError(400, 'A title, a summary and a body are all required');
  if (!Article.CATEGORIES.includes(category)) {
    throw new HttpError(400, `Category must be one of: ${Article.CATEGORIES.join(', ')}`);
  }

  const article = await Article.create({
    reporter: req.user._id,
    category,
    draft: { title, summary, body, image: image || undefined },
    draftStatus: 'draft'
  });

  logger.info('article created', { by: req.user.username, article: String(article._id), category });

  // No Location header: it would name a URL that 404s until this is published.
  res.status(201).json(asDraft(article));
}

// The autosave. Writes the working copy as the reporter types, so the work
// survives a refresh or a different computer.
async function update(req, res) {
  const article = req.target;

  if (req.body.category !== undefined) {
    throw new HttpError(400, 'The category can only be chosen when the article is created');
  }

  if (!article.draft) throw new HttpError(409, 'There is no working copy to edit');
  if (!mayEdit(article, req.user)) {
    throw new HttpError(403, 'Only the reporter who owns this article, or an editor, can edit it');
  }

  if (article.draftStatus === 'pending' && !isEditor(req.user)) {
    throw new HttpError(409, 'This article is with the editor and cannot be edited');
  }

  // Field by field: assigning an object to draft would drop the fields left out.
  for (const field of DRAFT_FIELDS) {
    if (req.body[field] === undefined) continue;

    if (typeof req.body[field] !== 'string') {
      throw new HttpError(400, `The ${field} has to be text`);
    }

    const value = req.body[field].trim();

    // An empty image means remove it
    if (field === 'image') article.draft.image = value || undefined;
    else if (value) article.draft[field] = value;
  }

  await article.save();

  res.json(asDraft(article));
}

async function revise(req, res) {
  const article = req.target;
  apply(article, 'revise', req.user);
  await article.save();

  logger.info('article revised', { by: req.user.username, article: String(article._id) });

  res.json(asDraft(article));
}

async function submit(req, res) {
  const article = req.target;
  apply(article, 'submit', req.user);
  await article.save();

  logger.info('article submitted', { by: req.user.username, article: String(article._id) });

  res.json(asDraft(article));
}

module.exports = { list, one, view, create, update, revise, submit, asCard };
