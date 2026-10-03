const mongoose = require('mongoose');

const { HttpError } = require('../errors');
const Article = require('../models/article');
const Comment = require('../models/comment');
const { secondsUntilAllowed, LIMIT } = require('../services/commentLimit');
const logger = require('../logger');

const PAGE = 20;
const MAX_AUTHOR = 60;
const MAX_TEXT = 2000;

const asComment = (comment) => ({
  id: String(comment._id),
  author: comment.author,
  text: comment.text,
  createdAt: comment.createdAt,

  // So a reader can tell the words are not entirely the author's any more.
  edited: comment.updatedAt > comment.createdAt
});

const encode = (comment) => Buffer.from(JSON.stringify([comment.createdAt, String(comment._id)])).toString('base64url');

// Arrives in a query string like any other input, so it is checked as something
// a stranger wrote: an id of { "$gt": "" } must not reach the query as an operator.
function decode(cursor) {
  let at;
  let id;

  try {
    [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch (err) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  const date = typeof at === 'string' ? new Date(at) : new Date(NaN);
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id) || Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'That is not a usable cursor');
  }

  return { at: date, id };
}

// Comments belong to articles a reader can see. A draft does not exist as far as
// the public is concerned, so it is a 404 and never a "not published yet".
async function publishedArticle(id) {
  const article = await Article.findById(id).select('published');
  if (!article || !article.published) throw new HttpError(404, 'No such article');
  return article;
}

async function list(req, res) {
  const article = await publishedArticle(req.params.id);

  const asked = Number(req.query.limit);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 50) : PAGE;

  const where = { article: article._id };

  if (req.query.after) {
    const { at, id } = decode(String(req.query.after));
    where.$or = [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: id } }];
  }

  // One more than asked for, only to learn whether another page exists.
  const found = await Comment.find(where).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
  const page = found.slice(0, limit);

  res.json({
    comments: page.map(asComment),
    nextCursor: found.length > limit ? encode(page[page.length - 1]) : null
  });
}

// Text only, and trimmed before it is judged: a comment of spaces is empty.
function readField(value, name, max) {
  if (typeof value !== 'string') throw new HttpError(400, `The ${name} has to be text`);

  const text = value.trim();
  if (!text) throw new HttpError(400, `The ${name} cannot be empty`);
  if (text.length > max) throw new HttpError(400, `The ${name} is longer than ${max} characters`);

  return text;
}

async function create(req, res) {
  const article = await publishedArticle(req.params.id);

  const author = readField(req.body.author, 'name', MAX_AUTHOR);
  const text = readField(req.body.text, 'comment', MAX_TEXT);

  const wait = await secondsUntilAllowed(req.visitorId);

  if (wait > 0) {
    logger.warn('comment blocked', { visitor: req.visitorId, article: String(article._id) });
    res.set('Retry-After', String(wait));
    throw new HttpError(429, `You can post ${LIMIT} comments a minute. Try again in ${wait} seconds`);
  }

  const comment = await Comment.create({
    article: article._id,
    author,
    text,
    visitorId: req.visitorId
  });

  await Article.updateOne({ _id: article._id }, { $inc: { commentCount: 1 } });

  // The new comment itself, so the page can add it to the list without asking
  // for the whole list again.
  res.status(201).set('Location', `/api/comments/${comment._id}`).json(asComment(comment));
}

// Moderation: an editor corrects or redacts the text. The name and the device
// are not accepted here, so the record of who wrote it cannot be rewritten.
async function update(req, res) {
  const comment = req.target;

  comment.text = readField(req.body.text, 'comment', MAX_TEXT);
  await comment.save();

  logger.info('comment edited', { by: req.user.username, comment: String(comment._id), article: String(comment.article) });

  res.json(asComment(comment));
}

async function remove(req, res) {
  const comment = req.target;

  await comment.deleteOne();
  await Article.updateOne({ _id: comment.article }, { $inc: { commentCount: -1 } });

  logger.info('comment deleted', { by: req.user.username, comment: String(comment._id), article: String(comment.article) });

  res.status(204).end();
}

module.exports = { list, create, update, remove };
