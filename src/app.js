const path = require('path');

const express = require('express');
const cookieParser = require('cookie-parser');

const routes = require('./routes');
const session = require('./session');
const visitor = require('./middlewares/visitor');
const asyncHandler = require('./middlewares/asyncHandler');
const { loadUser } = require('./middlewares/auth');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// The order here is the logic. Static files first, because there is no sense in
// searching the routes for a stylesheet. The not-found handler after every route
// has had its chance. The error middleware last of all, since Express only ever
// reaches it through next(err).
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieParser());
app.use(session);
app.use(visitor);

// loadUser reads the database, so it goes through asyncHandler like any other
// async step. A middleware that rejects is as bad as a handler that does.
app.use(asyncHandler(loadUser));

app.use(routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
