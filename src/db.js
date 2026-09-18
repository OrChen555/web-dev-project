const mongoose = require('mongoose');

const logger = require('./logger');

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

async function connect(uri) {
  // Five seconds rather than the default thirty, so a wrong URI says so at once
  // instead of looking like the process has hung.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  // Getting the first connection is server.js's problem. Losing it afterwards is
  // something we only hear about if we listen.
  mongoose.connection.on('error', (err) => logger.error('database error', { detail: err.message }));
  mongoose.connection.on('disconnected', () => logger.warn('database disconnected'));
}

const state = () => STATES[mongoose.connection.readyState] || 'unknown';

// A health check that throws says less than one that reports.
async function ping() {
  try {
    await mongoose.connection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}

module.exports = { connect, state, ping };
