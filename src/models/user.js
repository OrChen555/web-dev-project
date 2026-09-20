const mongoose = require('mongoose');

// Two roles, not the three the requirements name, because a guest is not a
// record. It is the absence of a session, and there is nothing to store.
const ROLES = ['reporter', 'editor'];

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  name: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: ROLES },
  isAdmin: { type: Boolean, default: false }
}, { timestamps: true });

// One administrator at most, settled by the database rather than by a check in
// our own code that somebody can forget to call.
userSchema.index({ isAdmin: 1 }, { unique: true, partialFilterExpression: { isAdmin: true } });

// select: false already keeps the hash out of ordinary queries. This keeps it
// out of a response even when someone has asked for it on purpose.
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
