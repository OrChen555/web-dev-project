const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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

// Callers set a plain password and never touch the hash. Hashing belongs to the
// model rather than to whoever happens to be creating a user, so that there is
// no route into this collection that stores a readable password by accident.
userSchema.virtual('password').set(function (plain) {
  this.passwordHash = plain;
});

userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return;
  this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
});

// bcrypt hashes cannot be reversed, so signing in means hashing what was just
// typed and comparing. The caller has to ask for the hash with
// .select('+passwordHash'), which makes the one place that touches it visible.
userSchema.methods.checkPassword = function (given) {
  return bcrypt.compare(given, this.passwordHash);
};

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
