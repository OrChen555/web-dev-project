const mongoose = require('mongoose');

const CATEGORIES = ['news', 'politics', 'economy', 'sports', 'culture', 'technology', 'health'];
const DRAFT_STATUSES = ['draft', 'pending', 'returned'];

// One version of the copy. Every article carries two of these, and they never
// overwrite each other: that is what lets a published article be rewritten
// without the site showing the rewrite.
const versionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  summary: { type: String, required: true, trim: true },
  body: { type: String, required: true },
  image: { type: String, trim: true }
}, { _id: false });

const noteSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, required: true }
}, { _id: false });

const publicationSchema = new mongoose.Schema({
  at: { type: Date, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { _id: false });

const articleSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, required: true, enum: CATEGORIES },

  published: { type: versionSchema, default: null },
  publishedAt: { type: Date, default: null },

  draft: { type: versionSchema, default: null },
  // Null whenever there is no working copy. The enum has no value for "nothing
  // in progress", and leaving it at 'draft' put every published article into
  // the editor's queue index looking like a draft.
  draftStatus: { type: String, enum: [...DRAFT_STATUSES, null], default: null },

  editorNote: { type: noteSchema, default: null },

  // Every approval, so that the analytics chart can mark the moments an update
  // reached readers. A single publishedAt would remember only the last one.
  publishHistory: { type: [publicationSchema], default: [] },

  viewCount: { type: Number, default: 0 },
  commentCount: { type: Number, default: 0 }
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// An article that is live and has an update waiting is two things at once, so
// the public side and the newsroom side each ask their own question.
articleSchema.virtual('isLive').get(function () {
  return Boolean(this.published);
});

articleSchema.virtual('state').get(function () {
  if (this.draft) return this.draftStatus;
  return this.isLive ? 'published' : 'draft';
});

// The _id is part of both feed keys so that paging can carry a cursor. Paging
// by skip re-reads everything before the offset, and shifts every later row
// whenever an article is published mid-scroll.
articleSchema.index({ publishedAt: -1, _id: -1 });
articleSchema.index({ viewCount: -1, _id: -1 });

// The same two orders within one category. Without them a category page walks
// the whole feed order and throws away the other six categories as it goes, or
// the planner reads every article in the category and sorts them in memory.
// Measured on 3,000 articles: 112 to 431 keys read for a page of 21, against
// 21 to 22 with these. They also serve a bare category filter, which is why
// there is no { category: 1 } of its own. The numbers are in docs/indexes.md.
articleSchema.index({ category: 1, publishedAt: -1, _id: -1 });
articleSchema.index({ category: 1, viewCount: -1, _id: -1 });

articleSchema.index({ reporter: 1 });
articleSchema.index({ draftStatus: 1 });
articleSchema.index({ 'published.title': 'text' });

module.exports = mongoose.model('Article', articleSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.DRAFT_STATUSES = DRAFT_STATUSES;
