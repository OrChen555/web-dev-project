const session = require('express-session');
// connect-mongo 6 is an ES module, and under require it hands back named
// exports rather than the store itself. Version 5 and every tutorial still
// online use `const MongoStore = require('connect-mongo')`, which is a major
// version behind and fails here with "MongoStore.create is not a function".
const { MongoStore } = require('connect-mongo');

const config = require('./config');

// The store is the point of this file. express-session keeps sessions in the
// process by default, so a restart would sign everybody out, and the
// requirement is that it does not.
module.exports = session({
  secret: config.sessionSecret,
  resave: false,

  // No session document for someone who has not logged in. Readers outnumber
  // staff by a long way and there is nothing to remember about them here.
  saveUninitialized: false,

  store: MongoStore.create({ mongoUrl: config.mongoUri, collectionName: 'sessions' }),

  cookie: {
    // Script in the page cannot read it, so an XSS cannot walk off with a session.
    httpOnly: true,

    // Not sent on requests that arrive from another site.
    sameSite: 'lax',

    secure: config.isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});
