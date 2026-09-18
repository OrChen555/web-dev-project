require('dotenv').config();

// A missing variable should stop the process here, with the whole list of what
// is not set, rather than surface later as an odd failure inside whichever
// request happened to need it first.
const missing = ['MONGODB_URI'].filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Not set in the environment: ${missing.join(', ')}. See .env.example.`);
}

const env = process.env.NODE_ENV || 'development';

module.exports = Object.freeze({
  env,
  isProduction: env === 'production',
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI
});
