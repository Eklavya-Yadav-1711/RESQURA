const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.db');
const db = new DatabaseSync(dbPath);

const DEFAULT_SOS_MESSAGE = 'I am here. Please come and help me.';
const DEFAULT_SOS_RANGE_KM = 2;
// An SOS left running this long is treated as forgotten and auto-resolved.
const STALE_SOS_HOURS = Number(process.env.STALE_SOS_HOURS) || 6;

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    push_token TEXT,
    is_online INTEGER DEFAULT 0,
    latitude REAL DEFAULT 0,
    longitude REAL DEFAULT 0,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sos_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    victim_id INTEGER NOT NULL,
    victim_lat REAL NOT NULL,
    victim_lon REAL NOT NULL,
    message TEXT DEFAULT 'I am here. Please come and help me.',
    image_url TEXT,
    image_mime_type TEXT,
    image_name TEXT,
    status TEXT DEFAULT 'active',
    range_km REAL DEFAULT 2,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (victim_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS safety_timers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    note TEXT,
    status TEXT DEFAULT 'running',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    warned INTEGER DEFAULT 0,
    triggered_sos_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS emergency_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sos_responders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sos_id INTEGER NOT NULL,
    responder_id INTEGER NOT NULL,
    status TEXT DEFAULT 'alerted',
    responded_at DATETIME,
    arrived_at DATETIME,
    FOREIGN KEY (sos_id) REFERENCES sos_sessions(id),
    FOREIGN KEY (responder_id) REFERENCES users(id)
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

ensureColumn('sos_sessions', 'image_url', 'image_url TEXT');
ensureColumn('sos_sessions', 'image_mime_type', 'image_mime_type TEXT');
ensureColumn('sos_sessions', 'image_name', 'image_name TEXT');
// Unguessable id for the public tracking page shared with family.
ensureColumn('sos_sessions', 'share_token', 'share_token TEXT');

// One responder row per (sos, user) — makes INSERT OR IGNORE actually idempotent.
db.exec(`
  DELETE FROM sos_responders
  WHERE id NOT IN (
    SELECT MIN(id) FROM sos_responders GROUP BY sos_id, responder_id
  );
`);

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sos_responders_unique
    ON sos_responders (sos_id, responder_id);
  CREATE INDEX IF NOT EXISTS idx_sos_sessions_victim
    ON sos_sessions (victim_id, status);
  CREATE INDEX IF NOT EXISTS idx_sos_responders_responder
    ON sos_responders (responder_id, status);
  CREATE INDEX IF NOT EXISTS idx_users_online ON users (is_online);
  CREATE INDEX IF NOT EXISTS idx_contacts_user ON emergency_contacts (user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unique
    ON emergency_contacts (user_id, phone);
  CREATE INDEX IF NOT EXISTS idx_sos_share ON sos_sessions (share_token);
  CREATE INDEX IF NOT EXISTS idx_timers_running ON safety_timers (status, expires_at);
`);

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const queries = {
  createUser: db.prepare(`
    INSERT INTO users (name, phone, password) VALUES (?, ?, ?)
  `),
  getUserByPhone: db.prepare(`
    SELECT * FROM users WHERE phone = ?
  `),
  getUserById: db.prepare(`
    SELECT id, name, phone, push_token, is_online, latitude, longitude, last_seen, created_at
    FROM users WHERE id = ?
  `),
  updateLocation: db.prepare(`
    UPDATE users SET latitude = ?, longitude = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?
  `),
  updateOnlineStatus: db.prepare(`
    UPDATE users SET is_online = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?
  `),
  resetAllOnlineStatus: db.prepare(`
    UPDATE users SET is_online = 0 WHERE is_online = 1
  `),
  updatePushToken: db.prepare(`
    UPDATE users SET push_token = ? WHERE id = ?
  `),
  clearPushToken: db.prepare(`
    UPDATE users SET push_token = NULL WHERE push_token = ?
  `),
  getAllOnlineUsers: db.prepare(`
    SELECT id, name, latitude, longitude, is_online, push_token, last_seen
    FROM users WHERE is_online = 1
  `),
  getAllLocatedUsers: db.prepare(`
    SELECT id, name, latitude, longitude, is_online, push_token, last_seen
    FROM users
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
  `),

  createSOS: db.prepare(`
    INSERT INTO sos_sessions (
      victim_id, victim_lat, victim_lon, message, range_km,
      image_url, image_mime_type, image_name, share_token
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getSOSByShareToken: db.prepare(`
    SELECT ss.*, u.name AS victim_name
    FROM sos_sessions ss
    JOIN users u ON u.id = ss.victim_id
    WHERE ss.share_token = ?
  `),

  // --- safety timers: check in by the deadline or an SOS goes out for you ---
  createTimer: db.prepare(`
    INSERT INTO safety_timers (user_id, note, expires_at)
    VALUES (?, ?, datetime('now', ?))
  `),
  getRunningTimer: db.prepare(`
    SELECT * FROM safety_timers WHERE user_id = ? AND status = 'running'
    ORDER BY id DESC
  `),
  getTimerById: db.prepare(`
    SELECT * FROM safety_timers WHERE id = ?
  `),
  setTimerStatus: db.prepare(`
    UPDATE safety_timers SET status = ? WHERE id = ?
  `),
  extendTimer: db.prepare(`
    UPDATE safety_timers SET expires_at = datetime(expires_at, ?), warned = 0 WHERE id = ?
  `),
  listExpiredTimers: db.prepare(`
    SELECT t.*, u.name AS user_name, u.latitude, u.longitude, u.push_token
    FROM safety_timers t
    JOIN users u ON u.id = t.user_id
    WHERE t.status = 'running' AND t.expires_at <= datetime('now')
  `),
  listTimersToWarn: db.prepare(`
    SELECT t.*, u.name AS user_name, u.push_token
    FROM safety_timers t
    JOIN users u ON u.id = t.user_id
    WHERE t.status = 'running' AND t.warned = 0
      AND t.expires_at <= datetime('now', ?)
  `),
  markTimerWarned: db.prepare(`
    UPDATE safety_timers SET warned = 1 WHERE id = ?
  `),
  setTimerSOS: db.prepare(`
    UPDATE safety_timers SET triggered_sos_id = ?, status = 'expired' WHERE id = ?
  `),

  addContact: db.prepare(`
    INSERT OR IGNORE INTO emergency_contacts (user_id, name, phone) VALUES (?, ?, ?)
  `),
  getContacts: db.prepare(`
    SELECT id, name, phone, created_at FROM emergency_contacts
    WHERE user_id = ? ORDER BY created_at
  `),
  countContacts: db.prepare(`
    SELECT COUNT(*) AS count FROM emergency_contacts WHERE user_id = ?
  `),
  deleteContact: db.prepare(`
    DELETE FROM emergency_contacts WHERE id = ? AND user_id = ?
  `),
  getActiveSOS: db.prepare(`
    SELECT * FROM sos_sessions WHERE victim_id = ? AND status = 'active'
    ORDER BY started_at DESC
  `),
  getSOSById: db.prepare(`
    SELECT * FROM sos_sessions WHERE id = ?
  `),
  getSOSWithVictim: db.prepare(`
    SELECT ss.*, u.name AS victim_name, u.phone AS victim_phone
    FROM sos_sessions ss
    JOIN users u ON u.id = ss.victim_id
    WHERE ss.id = ?
  `),
  setSOSImage: db.prepare(`
    UPDATE sos_sessions SET image_url = ?, image_mime_type = ?, image_name = ? WHERE id = ?
  `),
  setSOSMessage: db.prepare(`
    UPDATE sos_sessions SET message = ? WHERE id = ?
  `),
  endSOS: db.prepare(`
    UPDATE sos_sessions SET status = 'resolved', ended_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  endStaleSOS: db.prepare(`
    UPDATE sos_sessions
    SET status = 'resolved', ended_at = CURRENT_TIMESTAMP
    WHERE status = 'active' AND started_at <= datetime('now', ?)
  `),
  listStaleSOS: db.prepare(`
    SELECT id FROM sos_sessions
    WHERE status = 'active' AND started_at <= datetime('now', ?)
  `),
  updateSOSLocation: db.prepare(`
    UPDATE sos_sessions SET victim_lat = ?, victim_lon = ? WHERE id = ?
  `),
  countActiveSOS: db.prepare(`
    SELECT COUNT(*) AS count FROM sos_sessions WHERE status = 'active'
  `),

  addResponder: db.prepare(`
    INSERT OR IGNORE INTO sos_responders (sos_id, responder_id) VALUES (?, ?)
  `),
  updateResponderStatus: db.prepare(`
    UPDATE sos_responders SET status = ?, responded_at = CURRENT_TIMESTAMP
    WHERE sos_id = ? AND responder_id = ?
  `),
  markArrived: db.prepare(`
    UPDATE sos_responders SET status = 'arrived', arrived_at = CURRENT_TIMESTAMP
    WHERE sos_id = ? AND responder_id = ?
  `),
  getResponderRow: db.prepare(`
    SELECT * FROM sos_responders WHERE sos_id = ? AND responder_id = ?
  `),
  // Still-running emergencies this user was alerted to, so an app that was
  // closed when the alert fired can catch up on reopening.
  getIncomingSOSForUser: db.prepare(`
    SELECT ss.*, sr.status AS responder_status,
           u.name AS victim_name
    FROM sos_responders sr
    JOIN sos_sessions ss ON ss.id = sr.sos_id
    JOIN users u ON u.id = ss.victim_id
    WHERE sr.responder_id = ?
      AND ss.status = 'active'
      AND ss.victim_id != ?
      AND sr.status IN ('alerted', 'responding')
    ORDER BY ss.started_at DESC
  `),
  getSOSResponders: db.prepare(`
    SELECT u.id, u.name, u.latitude, u.longitude, sr.status, sr.responded_at, sr.arrived_at
    FROM sos_responders sr
    JOIN users u ON u.id = sr.responder_id
    WHERE sr.sos_id = ?
    ORDER BY sr.responded_at IS NULL, sr.responded_at ASC
  `),
};

function getUsersInRange(lat, lon, rangeKm, excludeUserId, options = {}) {
  const users = options.onlineOnly ? queries.getAllOnlineUsers.all() : queries.getAllLocatedUsers.all();
  return users
    .filter((user) => {
      if (user.id === excludeUserId) return false;
      if (!user.latitude || !user.longitude) return false;
      const dist = getDistance(lat, lon, user.latitude, user.longitude);
      user.distance = dist;
      return dist <= rangeKm;
    })
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Closes SOS sessions that were never ended (app killed, phone died).
 * Returns the ids that were closed so callers can notify their responders.
 */
function resolveStaleSOS(maxAgeHours = STALE_SOS_HOURS) {
  const modifier = `-${Math.max(1, Number(maxAgeHours) || STALE_SOS_HOURS)} hours`;
  const stale = queries.listStaleSOS.all(modifier).map((row) => row.id);
  if (stale.length) queries.endStaleSOS.run(modifier);
  return stale;
}

module.exports = {
  db,
  dbPath,
  queries,
  getUsersInRange,
  getDistance,
  resolveStaleSOS,
  DEFAULT_SOS_MESSAGE,
  DEFAULT_SOS_RANGE_KM,
  STALE_SOS_HOURS,
};
