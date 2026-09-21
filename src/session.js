const mongoose = require('mongoose');
const session = require('express-session');
// connect-mongo 6 is an ES module, and under require it hands back named
// exports rather than the store itself. Version 5 and every tutorial still
// online use `const MongoStore = require('connect-mongo')`, which is a major
// version behind and fails here with "MongoStore.create is not a function".
const { MongoStore } = require('connect-mongo');

const config = require('./config');

// Named here rather than left to express-session's default. Signing out has to
// clear this exact cookie, and two files agreeing on 'connect.sid' by
// coincidence is not an agreement.
const COOKIE_NAME = 'sid';

// clearCookie only clears a cookie whose path, sameSite and secure match the
// ones it was set with, so the attributes live here and both files read them.
const COOKIE_OPTIONS = Object.freeze({
  path: '/',

  // Script in the page cannot read it, so an XSS cannot walk off with a session.
  httpOnly: true,

  // Not sent on requests that arrive from another site.
  sameSite: 'lax',

  secure: config.isProduction
});

// connect-mongo asks for the client once, while the store is being built, and
// this file is required before db.connect() has run. asPromise() is no help
// here: on a connection nobody has asked to connect yet it resolves straight
// away, and getClient() on what it hands back is undefined. So the event is
// waited for instead.
const sharedClient = () =>
  mongoose.connection.readyState === 1
    ? Promise.resolve(mongoose.connection.getClient())
    : new Promise((resolve) => {
      mongoose.connection.once('connected', () => resolve(mongoose.connection.getClient()));
    });

// The store is the point of this file. express-session keeps sessions in the
// process by default, so a restart would sign everybody out, and the
// requirement is that it does not.
const middleware = session({
  name: COOKIE_NAME,
  secret: config.sessionSecret,
  resave: false,

  // No session document for someone who has not logged in. Readers outnumber
  // staff by a long way and there is nothing to remember about them here.
  saveUninitialized: false,

  // The connection mongoose already owns, rather than a second pool of our own
  // against the same database.
  store: MongoStore.create({ clientPromise: sharedClient(), collectionName: 'sessions' }),

  cookie: { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 }
});

module.exports = { middleware, COOKIE_NAME, COOKIE_OPTIONS };
