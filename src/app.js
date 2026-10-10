const path = require('path');

const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config');
const Article = require('./models/article');
const weather = require('./services/weather');
const routes = require('./routes');
const { middleware: session } = require('./session');
const visitor = require('./middlewares/visitor');
const asyncHandler = require('./middlewares/asyncHandler');
const { loadUser } = require('./middlewares/auth');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// The category enum is English and stable; what a reader sees is Hebrew, and it
// is decided once here so that every view says the same thing. In the order of
// the enum, which is the order the feed's select lists them.
app.locals.categoryNames = Object.freeze({
  news: 'חדשות',
  politics: 'פוליטיקה',
  economy: 'כלכלה',
  sports: 'ספורט',
  culture: 'תרבות',
  technology: 'טכנולוגיה',
  health: 'בריאות'
});

// A category added to the model without a name here would show up as its bare
// English key. Better to refuse to start than to find that on the live site.
const unnamed = Article.CATEGORIES.filter((c) => !app.locals.categoryNames[c]);
if (unnamed.length) throw new Error(`No Hebrew name for categor${unnamed.length > 1 ? 'ies' : 'y'}: ${unnamed.join(', ')}`);

// The same for the weather widget's cities: the service keeps the list and the
// coordinates, the reader sees these.
app.locals.cityNames = Object.freeze({
  'tel-aviv': 'תל אביב',
  jerusalem: 'ירושלים',
  haifa: 'חיפה',
  'beer-sheva': 'באר שבע',
  eilat: 'אילת'
});
app.locals.defaultCity = weather.DEFAULT_CITY;

const nameless = weather.CITIES.filter((c) => !app.locals.cityNames[c]);
if (nameless.length) throw new Error(`No Hebrew name for cit${nameless.length > 1 ? 'ies' : 'y'}: ${nameless.join(', ')}`);

// The order here is the logic. Static files first, because there is no sense in
// searching the routes for a stylesheet. The not-found handler after every route
// has had its chance. The error middleware last of all, since Express only ever
// reaches it through next(err).
app.use(express.static(path.join(__dirname, '..', 'public')));

// Chart.js, the one browser library the requirements name, served from the
// installed package rather than copied into public/ or pulled from a CDN: npm
// install is then the only way to get it, and the demo works without internet.
app.use('/vendor/chart.js', express.static(path.dirname(require.resolve('chart.js'))));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// The same secret the session is signed with. Without one here, res.cookie's
// signed option is silently unavailable and visitor ids would be forgeable.
app.use(cookieParser(config.sessionSecret));
app.use(session);
app.use(visitor);

// loadUser reads the database, so it goes through asyncHandler like any other
// async step. A middleware that rejects is as bad as a handler that does.
app.use(asyncHandler(loadUser));

// The page being shown, so the masthead can mark which of its links you are on.
app.use((req, res, next) => {
  res.locals.path = req.path;
  next();
});

app.use(routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
