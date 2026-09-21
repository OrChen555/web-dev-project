const mongoose = require('mongoose');

const WINDOW_MINUTES = 15;

const viewBucketSchema = new mongoose.Schema({
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  bucket: { type: Date, required: true },
  count: { type: Number, default: 0 }
});

// A view is one upsert with an increment against this key. Storing a document
// per view makes the write cheap and the chart expensive, because drawing a
// week would mean reading every view in it.
viewBucketSchema.index({ article: 1, bucket: 1 }, { unique: true });

// Fifteen minutes rather than an hour: the worked example in the requirements
// is an article updated at 14:00, and an hourly window would smear the update
// into the hour that contains it.
viewBucketSchema.statics.windowFor = function (date) {
  const start = new Date(date);
  start.setSeconds(0, 0);
  start.setMinutes(Math.floor(start.getMinutes() / WINDOW_MINUTES) * WINDOW_MINUTES);
  return start;
};

module.exports = mongoose.model('ViewBucket', viewBucketSchema);
module.exports.WINDOW_MINUTES = WINDOW_MINUTES;
