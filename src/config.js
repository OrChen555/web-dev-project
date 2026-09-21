require('dotenv').config();

// A missing variable should stop the process here, with the whole list of what
// is not set, rather than surface later as an odd failure inside whichever
// request happened to need it first.
const missing = ['MONGODB_URI', 'SESSION_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'].filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Not set in the environment: ${missing.join(', ')}. See .env.example.`);
}

const env = process.env.NODE_ENV || 'development';

module.exports = Object.freeze({
  env,
  isProduction: env === 'production',
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI,
  sessionSecret: process.env.SESSION_SECRET,

  // The one administrator, created at startup and never through a route.
  admin: Object.freeze({
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD
  })
});
