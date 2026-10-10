const Article = require('../models/article');
const Comment = require('../models/comment');
const ViewBucket = require('../models/viewBucket');
const VisitorView = require('../models/visitorView');
const { pick, searchText, titleContains, limitOf, run } = require('./listing');

// The editor's side of the articles collection: every article whoever wrote it,
// in every state. The public feed asks "what is out", this asks "what is where".
// Reading the query string, searching and paging are the feed's own code, from
// services/listing.js, so both lists refuse and find the same things.

// The states as the editor filters by them. The first three are the working
// copy's status. "published" is every article readers can see, including one
// with a rewrite waiting, and "update" is exactly that rewrite case, because it
// is the one the editor has to read twice: what is out, and what would replace it.
const FILTERS = {
  draft: { draftStatus: 'draft' },
  pending: { draftStatus: 'pending' },
  returned: { draftStatus: 'returned' },
  published: { published: { $ne: null } },
  update: { published: { $ne: null }, draftStatus: 'pending' }
};

const SORTS = {
  updated: { field: 'updatedAt', order: -1 },
  popular: { field: 'viewCount', order: -1 }
};

async function list(query) {
  const status = pick(query.status, Object.keys(FILTERS), 'status');
  const category = pick(query.category, Article.CATEGORIES, 'category');
  const sort = SORTS[pick(query.sort, Object.keys(SORTS), 'sort') || 'updated'];
  const q = searchText(query.q);

  const where = status ? { ...FILTERS[status] } : {};
  if (category) where.category = category;

  // Both titles, because an article that was never published has only the one in
  // its working copy, and a rewrite may have changed the headline.
  if (q) where.$and = titleContains(q, ['published.title', 'draft.title']);

  return run(where, sort, limitOf(query.limit), query.after);
}

// The article and everything that only means something because of it. Left
// behind, the comments and view buckets would point at nothing and still be
// counted by anything that reads those collections.
async function remove(article) {
  await Promise.all([
    Comment.deleteMany({ article: article._id }),
    ViewBucket.deleteMany({ article: article._id }),
    VisitorView.deleteMany({ article: article._id })
  ]);

  await article.deleteOne();
}

module.exports = { list, remove, FILTERS: Object.keys(FILTERS) };
