const mongoose = require('mongoose');

const NINETY_DAYS = 90 * 24 * 60 * 60;

// Which articles a browser has already opened. A guest has no account, so the
// anonymous id in their cookie is the only thing to record this against.
//
// It cannot live in the browser: the seen filter combines with category,
// sorting and paging over thousands of articles, so the database has to apply
// it, which means the server has to know the answer.
const visitorViewSchema = new mongoose.Schema({
  visitorId: { type: String, required: true },
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true }
}, { timestamps: true });

// One row per device and article, however many times it is opened.
visitorViewSchema.index({ visitorId: 1, article: 1 }, { unique: true });

// The feed reads a visitor's newest rows, up to the ceiling in services/seen.
visitorViewSchema.index({ visitorId: 1, createdAt: -1 });

// Rows go after ninety days. Without this a device that stops visiting keeps
// its history forever; mongo removes them itself, with no job of ours to run.
visitorViewSchema.index({ createdAt: 1 }, { expireAfterSeconds: NINETY_DAYS });

module.exports = mongoose.model('VisitorView', visitorViewSchema);
