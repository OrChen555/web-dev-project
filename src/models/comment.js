const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  author: { type: String, required: true, trim: true, maxlength: 60 },
  text: { type: String, required: true, trim: true, maxlength: 2000 },

  // The device that posted it. Earns its place twice: the three a minute limit
  // counts by device, and moderation wants everything one device wrote.
  visitorId: { type: String, required: true }
}, { timestamps: true });

commentSchema.index({ article: 1, createdAt: -1 });
commentSchema.index({ visitorId: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', commentSchema);
