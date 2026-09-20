const mongoose = require('mongoose');

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

visitorViewSchema.index({ visitorId: 1, article: 1 }, { unique: true });

module.exports = mongoose.model('VisitorView', visitorViewSchema);
