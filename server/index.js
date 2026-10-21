require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const {
  db,
  queries,
  getUsersInRange,
  getDistance,
  resolveStaleSOS,
  DEFAULT_SOS_MESSAGE,
  DEFAULT_SOS_RANGE_KM,
  STALE_SOS_HOURS,
} = require('./database');
const { authMiddleware, optionalAuth, generateToken } = require('./auth');
const { storeImage, deleteStoredImage, UPLOAD_DIR, MAX_IMAGE_BYTES } = require('./storage');
const { sendPushNotifications, buildSOSPushMessage } = require('./push');
const { buildTrackPage } = require('./track-page');
const { findNearestHelp, EMERGENCY_HOTLINES } = require('./places');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e6,
});

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '12mb' }));

// SOS photos are served straight off disk — only their URL ever hits the DB.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: true }));

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_LENGTH = 300;
const MAX_RANGE_KM = 10;
const MAX_CONTACTS = 5;

// userId → Set<socketId>. A user may have several devices/tabs connected, and
// a reconnect must never let the dying socket unregister the fresh one.
const userSockets = new Map();
const socketToUser = new Map();

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function registerSocket(userId, socketId) {
  socketToUser.set(socketId, userId);
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
}

function unregisterSocket(socketId) {
  const userId = socketToUser.get(socketId);
  socketToUser.delete(socketId);
  if (userId === undefined) return null;

  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) userSockets.delete(userId);
  }
  return userId;
}

function isUserOnline(userId) {
  return userSockets.has(userId);
}

function onlineCount() {
  return userSockets.size;
}

/**
 * How many OTHER people are online. Seeing "1 online" while standing alone in
 * an empty room is worse than useless in an emergency app.
 */
function othersOnline(userId) {
  const total = onlineCount();
  return userId && isUserOnline(userId) ? Math.max(0, total - 1) : total;
}

/** Every connected user gets their own figure, with themselves removed. */
function broadcastOnlineCount() {
  const total = onlineCount();
  userSockets.forEach((sockets, userId) => {
    const count = Math.max(0, total - 1);
    sockets.forEach((socketId) => io.to(socketId).emit('online_count', { count, total }));
  });
}

/** Emits to every device the user has connected. Returns true if any got it. */
function emitToUser(userId, event, payload) {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return false;
  sockets.forEach((socketId) => io.to(socketId).emit(event, payload));
  return true;
}

function baseUrlFrom(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  if (!req) return '';
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = req.get('x-forwarded-host') || req.get('host');
  return host ? `${proto}://${host}` : '';
}

/** Turns the stored "/uploads/x.jpg" into a URL a phone can actually load. */
function toAbsoluteUrl(url, base) {
  if (!url) return null;
  if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url)) return url;
  return base ? `${base}${url}` : url;
}

function buildImagePayload(sos, base) {
  if (!sos?.image_url) return null;
  return {
    url: toAbsoluteUrl(sos.image_url, base),
    path: sos.image_url,
    mimeType: sos.image_mime_type || null,
    fileName: sos.image_name || null,
  };
}

function normalizeSOSMessage(message) {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  return (trimmed || DEFAULT_SOS_MESSAGE).slice(0, MAX_MESSAGE_LENGTH);
}

function normalizeRange(range) {
  const parsed = Number(range);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SOS_RANGE_KM;
  return Math.min(parsed, MAX_RANGE_KM);
}

function normalizeCoordinate(value, limit) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return null;
  return parsed;
}

function parseId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Full SOS view used by the details endpoint and the active-SOS endpoint. */
function serializeSOS(sos, base) {
  return {
    id: sos.id,
    victimId: sos.victim_id,
    victimName: sos.victim_name || null,
    location: { lat: sos.victim_lat, lon: sos.victim_lon },
    victim_lat: sos.victim_lat,
    victim_lon: sos.victim_lon,
    message: sos.message || DEFAULT_SOS_MESSAGE,
    image: buildImagePayload(sos, base),
    imageUrl: toAbsoluteUrl(sos.image_url, base),
    hasImage: Boolean(sos.image_url),
    status: sos.status,
    range_km: sos.range_km,
    started_at: sos.started_at,
    ended_at: sos.ended_at,
    shareToken: sos.share_token || null,
  };
}

function fail(res, statusCode, error) {
  return res.status(statusCode).json({ error });
}

// ─────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    status: 'RESQORA server running',
    port: PORT,
    uptime: Math.round(process.uptime()),
    onlineCount: onlineCount(),
    activeSOS: queries.countActiveSOS.get().count,
  });
});

// Client-readable defaults so the app never hardcodes a stale radius/message.
app.get('/config', (req, res) => {
  res.json({
    defaultMessage: DEFAULT_SOS_MESSAGE,
    defaultRangeKm: DEFAULT_SOS_RANGE_KM,
    maxRangeKm: MAX_RANGE_KM,
    maxMessageLength: MAX_MESSAGE_LENGTH,
    maxImageBytes: MAX_IMAGE_BYTES,
    imageEnabled: true,
    hotlines: EMERGENCY_HOTLINES,
  });
});

// Public, but personalised when a token is sent: "online" means other people.
app.get('/stats', optionalAuth, (req, res) => {
  res.json({
    othersOnline: othersOnline(req.user?.userId),
    onlineCount: onlineCount(),
    activeSOS: queries.countActiveSOS.get().count,
  });
});

/**
 * Public live-tracking page. Anyone with the link sees the emergency on a map
 * — no app, no account. The token is unguessable and only ever printed by the
 * victim's own device.
 */
app.get('/t/:token', (req, res) => {
  const sos = queries.getSOSByShareToken.get(req.params.token);
  if (!sos) return res.status(404).send('This tracking link is not valid.');

  res.set('Cache-Control', 'no-store');
  res.type('html').send(buildTrackPage(req.params.token));
});

app.get('/t/:token/data', (req, res) => {
  const sos = queries.getSOSByShareToken.get(req.params.token);
  if (!sos) return fail(res, 404, 'Unknown tracking link');

  const base = baseUrlFrom(req);
  const responders = queries.getSOSResponders.all(sos.id);

  res.set('Cache-Control', 'no-store');
  res.json({
    status: sos.status,
    victimName: sos.victim_name,
    message: sos.message || DEFAULT_SOS_MESSAGE,
    lat: sos.victim_lat,
    lon: sos.victim_lon,
    imageUrl: toAbsoluteUrl(sos.image_url, base),
    startedAt: sos.started_at,
    endedAt: sos.ended_at,
    updatedAt: new Date().toISOString(),
    respondersCount: responders.filter((r) => r.status === 'responding' || r.status === 'arrived').length,
  });
});

app.post('/auth/register', async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
    const { password } = req.body;

    if (!name || !phone || !password)
      return fail(res, 400, 'Name, phone and password required');
    if (typeof password !== 'string' || password.length < 4)
      return fail(res, 400, 'Password must be at least 4 characters');

    const existing = queries.getUserByPhone.get(phone);
    if (existing) return fail(res, 400, 'Phone number already registered');

    const hashed = await bcrypt.hash(password, 10);
    const result = queries.createUser.run(name, phone, hashed);
    const userId = Number(result.lastInsertRowid);
    const token = generateToken(userId);

    res.json({ success: true, token, user: { id: userId, name, phone } });
  } catch (err) {
    console.error('Register error:', err);
    fail(res, 500, 'Registration failed');
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
    const { password } = req.body;
    if (!phone || !password) return fail(res, 400, 'Phone and password required');

    const user = queries.getUserByPhone.get(phone);
    if (!user) return fail(res, 400, 'User not found');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return fail(res, 400, 'Wrong password');

    const token = generateToken(user.id);
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, phone: user.phone },
    });
  } catch (err) {
    console.error('Login error:', err);
    fail(res, 500, 'Login failed');
  }
});

// ─────────────────────────────────────────
// USER ROUTES
// ─────────────────────────────────────────

app.get('/user/me', authMiddleware, (req, res) => {
  const user = queries.getUserById.get(req.user.userId);
  if (!user) return fail(res, 404, 'User not found');
  res.json({ user: { ...user, is_online: isUserOnline(user.id) ? 1 : user.is_online } });
});

app.post('/user/push-token', authMiddleware, (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  if (!token) return fail(res, 400, 'Push token required');
  queries.updatePushToken.run(token.slice(0, 200), req.user.userId);
  res.json({ success: true });
});

// Location can also be posted over REST, for clients without a live socket.
app.post('/user/location', authMiddleware, (req, res) => {
  const lat = normalizeCoordinate(req.body.lat, 90);
  const lon = normalizeCoordinate(req.body.lon, 180);
  if (lat === null || lon === null) return fail(res, 400, 'Valid lat and lon required');

  queries.updateLocation.run(lat, lon, req.user.userId);
  broadcastVictimLocation(req.user.userId, lat, lon);
  res.json({ success: true });
});

// Emergency contacts: the people told directly when you raise an SOS, so an
// alert still reaches someone when nobody is within range.
app.get('/contacts', authMiddleware, (req, res) => {
  res.json({ contacts: queries.getContacts.all(req.user.userId), max: MAX_CONTACTS });
});

app.post('/contacts', authMiddleware, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 20) : '';

  if (!name) return fail(res, 400, 'Give this contact a name');
  if (!/^[\d+][\d\s-]{5,}$/.test(phone)) return fail(res, 400, 'Enter a valid phone number');

  const { count } = queries.countContacts.get(req.user.userId);
  if (count >= MAX_CONTACTS) return fail(res, 400, `You can have up to ${MAX_CONTACTS} contacts`);

  queries.addContact.run(req.user.userId, name, phone);
  res.json({ success: true, contacts: queries.getContacts.all(req.user.userId) });
});

app.delete('/contacts/:id', authMiddleware, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, 'Invalid contact id');

  queries.deleteContact.run(id, req.user.userId);
  res.json({ success: true, contacts: queries.getContacts.all(req.user.userId) });
});

app.get('/nearby', authMiddleware, (req, res) => {
  const lat = normalizeCoordinate(req.query.lat, 90);
  const lon = normalizeCoordinate(req.query.lon, 180);
  if (lat === null || lon === null) return fail(res, 400, 'Valid lat and lon required');

  const rangeKm = normalizeRange(req.query.range);
  const nearby = getUsersInRange(lat, lon, rangeKm, req.user.userId, { onlineOnly: true });

  res.json({
    users: nearby.map((u) => ({ id: u.id, name: u.name, distance: u.distance })),
    count: nearby.length,
    range: rangeKm,
  });
});

/**
 * Nearest police station and hospital, from OpenStreetMap via Overpass.
 * Cached server-side and fails soft — the hotlines below always work even
 * when the lookup does not.
 */
app.get('/nearby/help', authMiddleware, async (req, res) => {
  const lat = normalizeCoordinate(req.query.lat, 90);
  const lon = normalizeCoordinate(req.query.lon, 180);
  if (lat === null || lon === null) return fail(res, 400, 'Valid lat and lon required');

  const radius = Math.min(Math.max(Number(req.query.radius) || 5000, 500), 20000);
  const kinds = typeof req.query.kinds === 'string'
    ? req.query.kinds.split(',').map((k) => k.trim()).filter(Boolean)
    : ['police', 'hospital'];

  const result = await findNearestHelp(lat, lon, { radiusMeters: radius, kinds });

  res.json({
    places: result.places,
    hotlines: EMERGENCY_HOTLINES,
    cached: result.cached,
    failed: result.failed,
    attribution: 'Data from OpenStreetMap contributors',
  });
});

app.get('/profile/stats', authMiddleware, (req, res) => {
  try {
    const sosSent = db
      .prepare('SELECT COUNT(*) as count FROM sos_sessions WHERE victim_id = ?')
      .get(req.user.userId);
    const timesHelped = db
      .prepare(`SELECT COUNT(*) as count FROM sos_responders
                WHERE responder_id = ? AND status IN ('responding','arrived')`)
      .get(req.user.userId);
    const user = queries.getUserById.get(req.user.userId);
    if (!user) return fail(res, 404, 'User not found');

    res.json({
      sosSent: sosSent.count,
      timesHelped: timesHelped.count,
      memberSince: user.created_at || user.last_seen,
      rangeKm: DEFAULT_SOS_RANGE_KM,
    });
  } catch (err) {
    console.error('Profile stats error:', err);
    fail(res, 500, 'Failed to fetch stats');
  }
});

app.get('/history', authMiddleware, (req, res) => {
  try {
    const base = baseUrlFrom(req);
    const rows = db.prepare(`
      SELECT ss.id, ss.message, ss.image_url, ss.image_mime_type, ss.image_name,
             ss.status, ss.started_at, ss.ended_at, ss.range_km,
             ss.victim_lat, ss.victim_lon,
             u.id as responder_id, u.name as responder_name, sr.status as responder_status
      FROM sos_sessions ss
      LEFT JOIN sos_responders sr ON sr.sos_id = ss.id AND sr.status IN ('responding','arrived')
      LEFT JOIN users u ON u.id = sr.responder_id
      WHERE ss.victim_id = ?
      ORDER BY ss.started_at DESC
    `).all(req.user.userId);

    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.id)) {
        map.set(row.id, {
          id: row.id,
          message: row.message,
          image: buildImagePayload(row, base),
          imageUrl: toAbsoluteUrl(row.image_url, base),
          hasImage: Boolean(row.image_url),
          status: row.status,
          range_km: row.range_km,
          location: { lat: row.victim_lat, lon: row.victim_lon },
          started_at: row.started_at,
          ended_at: row.ended_at,
          responders: [],
        });
      }
      if (row.responder_id) {
        map.get(row.id).responders.push({
          id: row.responder_id,
          name: row.responder_name,
          status: row.responder_status,
        });
      }
    });

    res.json({ history: Array.from(map.values()) });
  } catch (err) {
    console.error('History error:', err);
    fail(res, 500, 'Failed to fetch history');
  }
});

// ─────────────────────────────────────────
// SOS ROUTES
// ─────────────────────────────────────────

/**
 * Trigger an SOS: saves the session, stores the optional photo, then pushes
 * "location + message + image" to everyone inside the radius (2 km default).
 */
/**
 * Raises an SOS and fans it out: responders in range, live sockets first,
 * push for anyone whose app is closed. Shared by the button and by the safety
 * timer, so an automatic alert is identical to one you press yourself.
 */
function raiseSOS({ userId, lat, lon, message, range, storedImage = null, base = '' }) {
  const victim = queries.getUserById.get(userId);
  if (!victim) throw Object.assign(new Error('User not found'), { statusCode: 404 });

  const sosMessage = normalizeSOSMessage(message);
  const rangeKm = normalizeRange(range);
  const shareToken = crypto.randomBytes(9).toString('base64url');

  const result = queries.createSOS.run(
    userId, lat, lon, sosMessage, rangeKm,
    storedImage?.url || null, storedImage?.mimeType || null,
    storedImage?.fileName || null, shareToken
  );
  const sosId = Number(result.lastInsertRowid);

  queries.updateLocation.run(lat, lon, userId);

  const nearbyUsers = getUsersInRange(lat, lon, rangeKm, userId);
  nearbyUsers.forEach((u) => queries.addResponder.run(sosId, u.id));

  const imagePayload = storedImage
    ? {
        url: toAbsoluteUrl(storedImage.url, base),
        path: storedImage.url,
        mimeType: storedImage.mimeType,
        fileName: storedImage.fileName,
      }
    : null;

  const alertBody = {
    sosId,
    victim: { id: victim.id, name: victim.name },
    location: { lat, lon },
    message: sosMessage,
    image: imagePayload,
    imageUrl: imagePayload?.url || null,
    hasImage: Boolean(imagePayload),
    range: rangeKm,
    startedAt: new Date().toISOString(),
  };

  let notifiedOnlineCount = 0;
  const offlineTargets = [];
  nearbyUsers.forEach((u) => {
    const delivered = emitToUser(u.id, 'sos_alert', { ...alertBody, distance: u.distance });
    if (delivered) notifiedOnlineCount += 1;
    else if (u.push_token) offlineTargets.push(u);
  });

  io.emit('sos_started', {
    sosId, lat, lon,
    alertedCount: nearbyUsers.length,
    notifiedOnlineCount,
  });

  if (offlineTargets.length) {
    sendPushNotifications(
      offlineTargets.map((u) => buildSOSPushMessage({
        pushToken: u.push_token,
        victimName: victim.name,
        distanceKm: u.distance,
        message: sosMessage,
        imageUrl: imagePayload?.url || null,
        sosId,
        location: { lat, lon },
        rangeKm,
      }))
    ).then((r) => {
      if (r.sent) console.log(`SOS ${sosId}: ${r.sent} push notification(s) sent`);
      // A token from an uninstalled or replaced app would swallow every future
      // alert in silence. Drop it so the user re-registers on next launch.
      r.dead?.forEach((token) => {
        queries.clearPushToken.run(token);
        console.warn(`Cleared a dead push token: ${token.slice(0, 28)}…`);
      });
    });
  }

  console.log(
    `SOS ${sosId} by ${victim.name}: ${nearbyUsers.length} in ${rangeKm}km, ` +
    `${notifiedOnlineCount} live${imagePayload ? ', image attached' : ''}`
  );

  return {
    sosId, victim, sosMessage, rangeKm, shareToken,
    imagePayload, nearbyUsers, notifiedOnlineCount,
  };
}

app.post('/sos/trigger', authMiddleware, async (req, res) => {
  let storedImage = null;
  try {
    const victimLat = normalizeCoordinate(req.body.lat, 90);
    const victimLon = normalizeCoordinate(req.body.lon, 180);
    if (victimLat === null || victimLon === null)
      return fail(res, 400, 'Valid location required');

    const existing = queries.getActiveSOS.get(req.user.userId);
    if (existing) {
      return res.status(400).json({
        error: 'You already have an active SOS',
        sos: serializeSOS(existing, baseUrlFrom(req)),
      });
    }

    storedImage = storeImage(req.body.image || req.body.imageUrl || null);

    const base = baseUrlFrom(req);
    const raised = raiseSOS({
      userId: req.user.userId,
      lat: victimLat,
      lon: victimLon,
      message: req.body.message,
      range: req.body.range,
      storedImage,
      base,
    });

    res.json({
      success: true,
      sosId: raised.sosId,
      alertedCount: raised.nearbyUsers.length,
      notifiedOnlineCount: raised.notifiedOnlineCount,
      message: raised.sosMessage,
      range: raised.rangeKm,
      location: { lat: victimLat, lon: victimLon },
      image: raised.imagePayload,
      imageUrl: raised.imagePayload?.url || null,
      hasImage: Boolean(raised.imagePayload),
      shareUrl: `${base}/t/${raised.shareToken}`,
      contacts: queries.getContacts.all(req.user.userId),
      alertedUsers: raised.nearbyUsers.map((u) => ({ id: u.id, name: u.name, distance: u.distance })),
    });
  } catch (err) {
    if (storedImage) deleteStoredImage(storedImage.url);
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    console.error('SOS trigger error:', err);
    fail(res, 500, 'Failed to trigger SOS');
  }
});

/**
 * Builds the same shape the socket "sos_alert" event carries, so the app can
 * render a replayed alert with the exact code path it uses for a live one.
 */
function buildAlertPayload(sos, viewer, base) {
  const distance = viewer?.latitude && viewer?.longitude
    ? getDistance(sos.victim_lat, sos.victim_lon, viewer.latitude, viewer.longitude)
    : null;
  const image = buildImagePayload(sos, base);

  return {
    sosId: sos.id,
    victim: { id: sos.victim_id, name: sos.victim_name },
    location: { lat: sos.victim_lat, lon: sos.victim_lon },
    message: sos.message || DEFAULT_SOS_MESSAGE,
    image,
    imageUrl: image?.url || null,
    hasImage: Boolean(sos.image_url),
    distance,
    range: sos.range_km,
    startedAt: sos.started_at,
    myStatus: sos.responder_status || 'alerted',
  };
}

/**
 * Emergencies near you that are still running and that you have not finished
 * responding to. This is what an app opened AFTER the alert fired reads, so a
 * missed socket event no longer means a blank screen.
 */
app.get('/sos/incoming', authMiddleware, (req, res) => {
  const viewer = queries.getUserById.get(req.user.userId);
  if (!viewer) return fail(res, 404, 'User not found');

  const base = baseUrlFrom(req);
  const alerts = queries.getIncomingSOSForUser
    .all(req.user.userId, req.user.userId)
    .map((sos) => buildAlertPayload(sos, viewer, base));

  res.json({ alerts, count: alerts.length });
});

/**
 * Escape hatch: end every SOS this user still has running. The app can get
 * into a state where the server says "you already have an active SOS" but the
 * phone has lost track of which one, and an emergency button that refuses to
 * work is worse than no button.
 */
app.post('/sos/mine/clear', authMiddleware, (req, res) => {
  const stuck = db
    .prepare("SELECT id FROM sos_sessions WHERE victim_id = ? AND status = 'active'")
    .all(req.user.userId);

  stuck.forEach(({ id }) => {
    queries.endSOS.run(id);
    notifySOSEnded(id);
    console.log(`SOS ${id} cleared by its owner`);
  });

  res.json({ success: true, cleared: stuck.length, sosIds: stuck.map((s) => s.id) });
});

// Victim's own active SOS (used to restore the live screen after a reload).
app.get('/sos/active', authMiddleware, (req, res) => {
  const sos = queries.getActiveSOS.get(req.user.userId);
  if (!sos) return res.json({ active: false });

  const base = baseUrlFrom(req);
  res.json({
    active: true,
    sos: serializeSOS(sos, base),
    shareUrl: sos.share_token ? `${base}/t/${sos.share_token}` : null,
    contacts: queries.getContacts.all(req.user.userId),
    responders: queries.getSOSResponders.all(sos.id),
  });
});

// Full details of one SOS — the responder screen reads message + photo here,
// so a reopened app no longer depends on the in-memory alert cache.
app.get('/sos/:sosId', authMiddleware, (req, res) => {
  const sosId = parseId(req.params.sosId);
  if (!sosId) return fail(res, 400, 'Invalid SOS id');

  const sos = queries.getSOSWithVictim.get(sosId);
  if (!sos) return fail(res, 404, 'SOS not found');

  const isVictim = sos.victim_id === req.user.userId;
  const isResponder = Boolean(queries.getResponderRow.get(sosId, req.user.userId));
  if (!isVictim && !isResponder)
    return fail(res, 403, 'You were not alerted for this SOS');

  res.json({
    sos: serializeSOS(sos, baseUrlFrom(req)),
    victim: { id: sos.victim_id, name: sos.victim_name },
    responders: queries.getSOSResponders.all(sosId),
    isVictim,
  });
});

// Attach or replace the SOS photo after the alert already went out.
app.post('/sos/:sosId/image', authMiddleware, (req, res) => {
  const sosId = parseId(req.params.sosId);
  if (!sosId) return fail(res, 400, 'Invalid SOS id');

  let storedImage = null;
  try {
    const sos = queries.getSOSById.get(sosId);
    if (!sos) return fail(res, 404, 'SOS not found');
    if (sos.victim_id !== req.user.userId)
      return fail(res, 403, 'Only the victim can attach an image');
    if (sos.status !== 'active') return fail(res, 400, 'SOS is not active');

    storedImage = storeImage(req.body.image || req.body.imageUrl || null);
    if (!storedImage) return fail(res, 400, 'Image required');

    const previousUrl = sos.image_url;
    queries.setSOSImage.run(
      storedImage.url,
      storedImage.mimeType,
      storedImage.fileName,
      sosId
    );
    if (previousUrl && previousUrl !== storedImage.url) deleteStoredImage(previousUrl);

    const base = baseUrlFrom(req);
    const imagePayload = {
      url: toAbsoluteUrl(storedImage.url, base),
      path: storedImage.url,
      mimeType: storedImage.mimeType,
      fileName: storedImage.fileName,
    };

    queries.getSOSResponders.all(sosId).forEach((r) => {
      emitToUser(r.id, 'sos_image', {
        sosId,
        image: imagePayload,
        imageUrl: imagePayload.url,
      });
    });

    res.json({ success: true, sosId, image: imagePayload, imageUrl: imagePayload.url });
  } catch (err) {
    if (storedImage) deleteStoredImage(storedImage.url);
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    console.error('SOS image error:', err);
    fail(res, 500, 'Failed to attach image');
  }
});

app.post('/sos/:sosId/respond', authMiddleware, (req, res) => {
  const sosId = parseId(req.params.sosId);
  if (!sosId) return fail(res, 400, 'Invalid SOS id');

  const sos = queries.getSOSById.get(sosId);
  if (!sos) return fail(res, 404, 'SOS not found');
  if (sos.status !== 'active') return fail(res, 400, 'SOS is not active');
  if (sos.victim_id === req.user.userId)
    return fail(res, 400, 'You cannot respond to your own SOS');

  // Someone who was offline when the alert fired still gets a responder row,
  // and someone who declined earlier can still change their mind.
  queries.addResponder.run(sosId, req.user.userId);
  queries.updateResponderStatus.run('responding', sosId, req.user.userId);

  const responder = queries.getUserById.get(req.user.userId);
  const distance = responder.latitude && responder.longitude
    ? getDistance(sos.victim_lat, sos.victim_lon, responder.latitude, responder.longitude)
    : null;

  emitToUser(sos.victim_id, 'responder_coming', {
    sosId,
    responder: { id: responder.id, name: responder.name },
    distance,
  });

  const responders = queries.getSOSResponders.all(sosId);
  io.emit('sos_updated', { sosId, responders });

  res.json({
    success: true,
    sosId,
    victim: { id: sos.victim_id },
    respondersCount: responders.filter((r) => r.status !== 'alerted').length,
  });
});

/** "I can't make it" — stop showing this responder as on their way. */
app.post('/sos/:sosId/withdraw', authMiddleware, (req, res) => {
  const sosId = parseId(req.params.sosId);
  if (!sosId) return fail(res, 400, 'Invalid SOS id');

  const sos = queries.getSOSById.get(sosId);
  if (!sos) return fail(res, 404, 'SOS not found');

  const row = queries.getResponderRow.get(sosId, req.user.userId);
  if (!row) return fail(res, 403, 'You were not alerted for this SOS');
  if (row.status === 'arrived') return fail(res, 400, 'You already arrived');

  queries.updateResponderStatus.run('declined', sosId, req.user.userId);
  const responder = queries.getUserById.get(req.user.userId);

  emitToUser(sos.victim_id, 'responder_left', {
    sosId,
    responder: { id: responder.id, name: responder.name },
  });
  io.emit('sos_updated', { sosId, responders: queries.getSOSResponders.all(sosId) });

  res.json({ success: true, sosId });
});

app.post('/sos/:sosId/arrived', authMiddleware, (req, res) => {
  const sosId = parseId(req.params.sosId);
  if (!sosId) return fail(res, 400, 'Invalid SOS id');

  const sos = queries.getSOSById.get(sosId);
  if (!sos) return fail(res, 404, 'SOS not found');

  const row = queries.getResponderRow.get(sosId, req.user.userId);
  if (!row) return fail(res, 403, 'You are not responding to this SOS');

  queries.markArrived.run(sosId, req.user.userId);
  const responder = queries.getUserById.get(req.user.userId);

  emitToUser(sos.victim_id, 'responder_arrived', {
    sosId,
    responder: { id: responder.id, name: responder.name },
  });

  io.emit('sos_updated', { sosId, responders: queries.getSOSResponders.all(sosId) });
  res.json({ success: true });
});

app.post('/sos/:sosId/end', authMiddleware, (req, res) => {
  const sosId = parseId(req.params.sosId);
  if (!sosId) return fail(res, 400, 'Invalid SOS id');

  const sos = queries.getSOSById.get(sosId);
  if (!sos) return fail(res, 404, 'SOS not found');
  if (sos.victim_id !== req.user.userId) return fail(res, 403, 'Only victim can end SOS');
  if (sos.status !== 'active') return res.json({ success: true, alreadyEnded: true });

  queries.endSOS.run(sosId);
  notifySOSEnded(sosId);

  res.json({ success: true, sosId });
});

function notifySOSEnded(sosId) {
  queries.getSOSResponders.all(sosId).forEach((r) => {
    emitToUser(r.id, 'sos_ended', { sosId });
  });
  io.emit('sos_ended', { sosId });
}

// JSON errors instead of Express HTML — including "payload too large".
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large')
    return fail(res, 413, 'Image is too large. Please attach a smaller image.');
  if (err.status === 400 && err.type === 'entity.parse.failed')
    return fail(res, 400, 'Invalid JSON body');
  console.error('Unhandled error:', err);
  fail(res, 500, 'Server error');
});

// ─────────────────────────────────────────
// SAFETY TIMER
// ─────────────────────────────────────────
//
// "I am walking home, expect me in 20 minutes." Miss the check-in and the
// server raises the SOS for you — which is the point: it still works when the
// phone is taken, dead, or you simply cannot reach it.

const MAX_TIMER_MINUTES = 8 * 60;
const WARN_BEFORE_MINUTES = 2;

function serializeTimer(timer) {
  if (!timer) return null;
  return {
    id: timer.id,
    note: timer.note || null,
    status: timer.status,
    startedAt: timer.started_at,
    expiresAt: timer.expires_at,
    warned: Boolean(timer.warned),
    triggeredSosId: timer.triggered_sos_id || null,
  };
}

function normalizeMinutes(value) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.min(parsed, MAX_TIMER_MINUTES);
}

app.get('/timer', authMiddleware, (req, res) => {
  res.json({ timer: serializeTimer(queries.getRunningTimer.get(req.user.userId)) });
});

app.post('/timer/start', authMiddleware, (req, res) => {
  const minutes = normalizeMinutes(req.body.minutes);
  if (!minutes) return fail(res, 400, 'Choose how many minutes you need');

  const running = queries.getRunningTimer.get(req.user.userId);
  if (running) {
    return res.status(400).json({
      error: 'You already have a timer running',
      timer: serializeTimer(running),
    });
  }

  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 120) : null;
  const result = queries.createTimer.run(req.user.userId, note || null, `+${minutes} minutes`);
  const timer = queries.getTimerById.get(Number(result.lastInsertRowid));

  console.log(`Safety timer ${timer.id} started by user ${req.user.userId} for ${minutes} min`);
  res.json({ success: true, timer: serializeTimer(timer) });
});

app.post('/timer/checkin', authMiddleware, (req, res) => {
  const timer = queries.getRunningTimer.get(req.user.userId);
  if (!timer) return fail(res, 404, 'You have no timer running');

  queries.setTimerStatus.run('safe', timer.id);
  res.json({ success: true, timer: serializeTimer(queries.getTimerById.get(timer.id)) });
});

app.post('/timer/cancel', authMiddleware, (req, res) => {
  const timer = queries.getRunningTimer.get(req.user.userId);
  if (!timer) return fail(res, 404, 'You have no timer running');

  queries.setTimerStatus.run('cancelled', timer.id);
  res.json({ success: true, timer: serializeTimer(queries.getTimerById.get(timer.id)) });
});

app.post('/timer/extend', authMiddleware, (req, res) => {
  const minutes = normalizeMinutes(req.body.minutes) || 10;
  const timer = queries.getRunningTimer.get(req.user.userId);
  if (!timer) return fail(res, 404, 'You have no timer running');

  queries.extendTimer.run(`+${minutes} minutes`, timer.id);
  res.json({ success: true, timer: serializeTimer(queries.getTimerById.get(timer.id)) });
});

function timerMessage(note) {
  return note
    ? `My safety timer ended and I did not check in. I was: ${note}. Please check on me.`
    : 'My safety timer ended and I did not check in. Please check on me.';
}

/** Nudges you shortly before the deadline, so a forgotten timer is not an SOS. */
function warnExpiringTimers() {
  const soon = queries.listTimersToWarn.all(`+${WARN_BEFORE_MINUTES} minutes`);
  soon.forEach((timer) => {
    queries.markTimerWarned.run(timer.id);
    const delivered = emitToUser(timer.user_id, 'timer_warning', {
      timerId: timer.id,
      expiresAt: timer.expires_at,
      minutesLeft: WARN_BEFORE_MINUTES,
    });

    if (!delivered && timer.push_token) {
      sendPushNotifications([{
        to: timer.push_token,
        title: 'Are you safe?',
        body: `Your safety timer ends in ${WARN_BEFORE_MINUTES} minutes. Check in, or an SOS goes out.`,
        sound: 'default',
        priority: 'high',
        channelId: 'sos-alerts',
        data: { type: 'timer_warning', timerId: timer.id },
      }]).catch(() => {});
    }
  });
}

/** The deadline passed with no check-in: raise the SOS on their behalf. */
function fireExpiredTimers() {
  const expired = queries.listExpiredTimers.all();

  expired.forEach((timer) => {
    const hasLocation = Number.isFinite(timer.latitude) && Number.isFinite(timer.longitude)
      && (timer.latitude !== 0 || timer.longitude !== 0);

    if (!hasLocation) {
      queries.setTimerStatus.run('expired', timer.id);
      console.warn(`Safety timer ${timer.id} expired but ${timer.user_name} has no known location`);
      return;
    }

    const already = queries.getActiveSOS.get(timer.user_id);
    if (already) {
      queries.setTimerSOS.run(already.id, timer.id);
      return;
    }

    try {
      const base = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, '') : '';
      const raised = raiseSOS({
        userId: timer.user_id,
        lat: timer.latitude,
        lon: timer.longitude,
        message: timerMessage(timer.note),
        range: DEFAULT_SOS_RANGE_KM,
        base,
      });

      queries.setTimerSOS.run(raised.sosId, timer.id);
      emitToUser(timer.user_id, 'timer_expired', {
        timerId: timer.id,
        sosId: raised.sosId,
      });
      console.log(`Safety timer ${timer.id} expired -> SOS ${raised.sosId} for ${timer.user_name}`);
    } catch (err) {
      queries.setTimerStatus.run('expired', timer.id);
      console.error(`Safety timer ${timer.id} could not raise an SOS:`, err.message);
    }
  });
}

const timerSweep = setInterval(() => {
  try {
    warnExpiringTimers();
    fireExpiredTimers();
  } catch (err) {
    console.error('Timer sweep error:', err);
  }
}, 15000);
timerSweep.unref?.();

// ─────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────

/** Pushes a victim's new position to everyone coming to help them. */
function broadcastVictimLocation(userId, lat, lon) {
  const activeSOS = queries.getActiveSOS.get(userId);
  if (!activeSOS) return;

  queries.updateSOSLocation.run(lat, lon, activeSOS.id);
  queries.getSOSResponders.all(activeSOS.id).forEach((r) => {
    emitToUser(r.id, 'victim_location_update', { sosId: activeSOS.id, lat, lon });
  });
}

io.on('connection', (socket) => {
  socket.on('authenticate', (data = {}) => {
    const userId = parseId(data.userId);
    if (!userId) return socket.emit('authenticated', { success: false, error: 'Invalid user id' });

    const user = queries.getUserById.get(userId);
    if (!user) return socket.emit('authenticated', { success: false, error: 'Unknown user' });

    registerSocket(userId, socket.id);
    queries.updateOnlineStatus.run(1, userId);

    console.log(`User ${userId} (${user.name}) online on ${socket.id}`);
    socket.emit('authenticated', { success: true, userId });
    broadcastOnlineCount();

    // Your own SOS is still running: the app returns you to its live screen.
    const activeSOS = queries.getActiveSOS.get(userId);
    if (activeSOS) socket.emit('sos_resume', { sosId: activeSOS.id });

    // Someone near you called for help while your app was closed: replay it
    // now instead of leaving the screen empty. Marked so the client can show
    // it without re-running the siren.
    const base = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, '') : '';
    queries.getIncomingSOSForUser
      .all(userId, userId)
      .forEach((sos) => {
        socket.emit('sos_alert', { ...buildAlertPayload(sos, user, base), resumed: true });
      });
  });

  socket.on('location_update', (data = {}) => {
    const userId = socketToUser.get(socket.id);
    if (!userId) return;

    const lat = normalizeCoordinate(data.lat, 90);
    const lon = normalizeCoordinate(data.lon, 180);
    if (lat === null || lon === null) return;

    queries.updateLocation.run(lat, lon, userId);
    broadcastVictimLocation(userId, lat, lon);
  });

  socket.on('responder_location_update', (data = {}) => {
    const userId = socketToUser.get(socket.id);
    if (!userId) return;

    const sosId = parseId(data.sosId);
    const lat = normalizeCoordinate(data.lat, 90);
    const lon = normalizeCoordinate(data.lon, 180);
    if (!sosId || lat === null || lon === null) return;

    queries.updateLocation.run(lat, lon, userId);

    const sos = queries.getSOSById.get(sosId);
    if (!sos || sos.status !== 'active') return;
    if (!queries.getResponderRow.get(sosId, userId)) return;

    emitToUser(sos.victim_id, 'responder_location', {
      sosId,
      responderId: userId,
      lat,
      lon,
      distance: getDistance(sos.victim_lat, sos.victim_lon, lat, lon),
    });
  });

  socket.on('disconnect', () => {
    const userId = unregisterSocket(socket.id);
    if (userId === null) return;
    if (!isUserOnline(userId)) {
      queries.updateOnlineStatus.run(0, userId);
      broadcastOnlineCount();
      console.log(`User ${userId} offline`);
    }
  });
});

// ─────────────────────────────────────────
// START
// ─────────────────────────────────────────

// A crash leaves stale "online" flags behind; clear them on boot.
queries.resetAllOnlineStatus.run();
resolveStaleSOS().forEach((sosId) => console.log(`Auto-resolved stale SOS ${sosId}`));

const staleTimer = setInterval(() => {
  resolveStaleSOS().forEach((sosId) => {
    console.log(`Auto-resolved stale SOS ${sosId}`);
    notifySOSEnded(sosId);
  });
}, 15 * 60 * 1000);
staleTimer.unref?.();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the other process (or another server instance) or set PORT to a free port.`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

function shutdown() {
  console.log('\nShutting down RESQORA server...');
  queries.resetAllOnlineStatus.run();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║         RESQORA SERVER LIVE          ║
  ╚══════════════════════════════════════╝
  Local:      http://localhost:${PORT}
  Uploads:    ${UPLOAD_DIR}
  SOS radius: ${DEFAULT_SOS_RANGE_KM} km
  Message:    "${DEFAULT_SOS_MESSAGE}"
  Stale SOS:  auto-resolved after ${STALE_SOS_HOURS}h
  `);
});

module.exports = { app, server, io };
