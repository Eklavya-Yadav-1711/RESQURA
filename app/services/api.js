import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// Public app configuration only.  Do not put a Supabase service-role key (or
// any other secret) in the mobile app: every value bundled here is readable by
// anybody who installs it.  Set EXPO_PUBLIC_API_URL in EAS/the build
// environment. The mobile app always uses the deployed Supabase Edge API.
const configuredServerUrl =
  process.env.EXPO_PUBLIC_API_URL ||
  (process.env.EXPO_PUBLIC_SUPABASE_URL
    ? `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/api`
    : Constants.expoConfig?.extra?.apiUrl || '');

export const SERVER_URL = configuredServerUrl.replace(/\/+$/, '');

function configuredApiUrl() {
  if (SERVER_URL && /^https:\/\/[^/]+\.supabase\.co\/functions\/v1\/api$/i.test(SERVER_URL)) {
    return SERVER_URL;
  }
  throw new Error(
    'RESQORA is not connected to the deployed Supabase API. Check the production app configuration.'
  );
}
export const DEFAULT_SOS_MESSAGE = 'I am here. Please come and help me.';
export const DEFAULT_SOS_RANGE_KM = 2;

// A one-time cutover removes the legacy local-server login cache from every
// device after the database reset. Supabase remains the configured API/auth
// provider; users will sign in again against the fresh remote project.
const SUPABASE_CUTOVER_KEY = 'resqora:supabase-cutover-v1';

let socket = null;
const sosAlertCache = new Map();

export function cacheSOSAlert(alert) {
  if (alert?.sosId) sosAlertCache.set(String(alert.sosId), alert);
}

export function getCachedSOSAlert(sosId) {
  return sosAlertCache.get(String(sosId));
}

/**
 * The server stores SOS photos as "/uploads/xyz.jpg". Turn whatever it hands
 * back into something <Image source={{ uri }} /> can actually load.
 */
export function resolveImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (/^(https?:|data:|file:)/i.test(url)) return url;
  return `${configuredApiUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Pulls the image URL out of any SOS-shaped payload (alert, history, details). */
export function getSOSImageUrl(source) {
  if (!source) return null;
  return resolveImageUrl(
    source.imageUrl
      || source.image_url
      || source.image?.url
      || source.image?.path
      || null
  );
}

// ngrok's free tier answers plain requests with an interstitial page; this
// header tells it to serve the real resource instead.
const NGROK_HEADERS = { 'ngrok-skip-browser-warning': 'true' };

/** Ready-to-use <Image source={...} /> for an SOS photo, or null. */
export function getSOSImageSource(source) {
  const uri = getSOSImageUrl(source);
  return uri ? { uri, headers: NGROK_HEADERS } : null;
}

/** fetch(), but a dead network says so in words instead of "Network request failed". */
async function fetchOrExplain(url, options) {
  try {
    return await fetch(url, options);
  } catch (err) {
    const error = new Error(
      `Cannot reach the RESQORA server at ${configuredApiUrl().replace(/^https?:\/\//, '')}. `
      + 'Check that it is running and that this phone is on the same network.'
    );
    error.offline = true;
    error.cause = err;
    throw error;
  }
}

// --- AUTH ------------------------------------------------------------------

export async function register(name, email, password) {
  const { error: authError } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { name } } });
  if (authError && !/already registered/i.test(authError.message || '')) throw authError;
  const res = await fetchOrExplain(`${configuredApiUrl()}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...NGROK_HEADERS },
    body: JSON.stringify({ name, phone: email, email, password }),
  });
  const data = await readJson(res, '/auth/register');
  if (!res.ok) throw new Error(data.error || 'Registration failed');
  await AsyncStorage.setItem('token', data.token);
  await AsyncStorage.setItem('user', JSON.stringify(data.user));
  return data;
}

export async function login(email, password) {
  const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (authError) throw authError;
  const res = await fetchOrExplain(`${configuredApiUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...NGROK_HEADERS },
    body: JSON.stringify({ phone: email, email, password }),
  });
  const data = await readJson(res, '/auth/login');
  if (!res.ok) throw new Error(data.error || 'Login failed');
  await AsyncStorage.setItem('token', data.token);
  await AsyncStorage.setItem('user', JSON.stringify(data.user));
  return data;
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: 'resqora://reset-password',
  });
  if (error) throw error;
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('Your reset link has expired. Request a new one and try again.');

  const res = await fetchOrExplain(`${configuredApiUrl()}/auth/password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...NGROK_HEADERS,
    },
    body: JSON.stringify({ password }),
  });
  const data = await readJson(res, '/auth/password');
  if (!res.ok) throw new Error(data.error || 'Could not update password');
}

export async function getStoredUser() {
  try {
    const cutoverComplete = await AsyncStorage.getItem(SUPABASE_CUTOVER_KEY);
    if (!cutoverComplete) {
      await AsyncStorage.multiRemove(['token', 'user']);
      await supabase.auth.signOut({ scope: 'local' });
      await AsyncStorage.setItem(SUPABASE_CUTOVER_KEY, '1');
      return null;
    }

    // This is a small session cache only. User, SOS, contact, and location
    // records are requested from the Supabase Edge API, never SQLite.
    const user = await AsyncStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  } catch {
    return null;
  }
}

export async function getToken() {
  return await AsyncStorage.getItem('token');
}

export async function logout() {
  await AsyncStorage.removeItem('token');
  await AsyncStorage.removeItem('user');
  if (socket?.channel) await supabase.removeChannel(socket.channel);
  socket = null;
}

// --- AUTHENTICATED FETCH ---------------------------------------------------

/**
 * Reads a response as JSON without ever throwing a raw parser error.
 *
 * Anything between the phone and the server can answer with something that is
 * not JSON — a captive portal, a proxy, an offline-tunnel page, a plain 502 —
 * and res.json() then fails with "Unexpected character: T", which tells the
 * user nothing. This turns that into a sentence they can act on.
 */
async function readJson(res, path) {
  const body = await res.text();

  try {
    return JSON.parse(body);
  } catch {
    const looksLikePage = /^\s*[<T]/i.test(body);
    const error = new Error(
      looksLikePage
        ? `Reached something that is not the RESQORA server (HTTP ${res.status}). `
          + 'Check that the backend is running and the address in the app is right.'
        : `The server sent an unreadable reply (HTTP ${res.status}).`
    );
    error.status = res.status;
    error.body = body.slice(0, 200);
    error.path = path;
    throw error;
  }
}

export async function authFetch(path, options = {}) {
  const token = await getToken();

  let res;
  try {
    res = await fetch(`${configuredApiUrl()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...NGROK_HEADERS,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    const error = new Error(
      `Cannot reach the RESQORA server at ${configuredApiUrl().replace(/^https?:\/\//, '')}. `
      + 'Check that it is running and that this phone is on the same network.'
    );
    error.offline = true;
    error.cause = err;
    throw error;
  }

  const data = await readJson(res, path);
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (HTTP ${res.status})`);
    error.status = res.status;
    error.data = data;   // e.g. the SOS you already have running
    throw error;
  }
  return data;
}

// --- SERVER INFO -----------------------------------------------------------

/**
 * Is the server reachable at all? Deliberately tiny and short-timeout: this
 * runs on a schedule and must never be the thing that hangs the screen.
 */
export async function pingServer(timeoutMs = 6000) {
  try {
    const res = await fetch(`${configuredApiUrl()}/config`, {
      headers: NGROK_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getServerConfig() {
  try {
    const res = await fetch(`${configuredApiUrl()}/config`, { headers: NGROK_HEADERS });
    return await res.json();
  } catch {
    return { defaultMessage: DEFAULT_SOS_MESSAGE, defaultRangeKm: DEFAULT_SOS_RANGE_KM };
  }
}

/**
 * How many OTHER people are online. Sent with the token so the server can
 * leave you out of your own count.
 */
export async function getOnlineCount() {
  try {
    const data = await authFetch('/stats');
    return data.othersOnline ?? data.onlineCount ?? 0;
  } catch {
    return 0;
  }
}

export async function getHistory() {
  return await authFetch('/history');
}

export async function getProfileStats() {
  return await authFetch('/profile/stats');
}

// --- SOCKET ----------------------------------------------------------------

export function connectSocket(userId) {
  if (socket) return socket;
  const listeners = new Map();
  const emit = (event, payload) => (listeners.get(event) || []).forEach((fn) => fn(payload));
  const channel = supabase.channel(`resqora-live-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_sessions' }, (change) => emit('sos_alert', change.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_sessions' }, (change) => { if (change.new.status !== 'active') emit('sos_ended', change.new); })
    .subscribe();
  socket = {
    channel,
    connected: true,
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); return this; },
    off(event, fn) { listeners.set(event, (listeners.get(event) || []).filter((x) => x !== fn)); return this; },
    emit() { return this; },
    disconnect() { supabase.removeChannel(channel); socket = null; },
  };
  return socket;
}

export function getSocket() {
  return socket;
}

export function sendLocationUpdate(lat, lon) {
  updateLocation(lat, lon).catch(() => {});
}

export function sendResponderLocation(sosId, lat, lon) {
  updateLocation(lat, lon).catch(() => {});
}

/** Nearest police stations and hospitals, from OpenStreetMap. */
function distanceKm(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function lookupNearbyFacilities(lat, lon, radius) {
  const delta = radius / 111000;
  const viewbox = `${lon - delta},${lat + delta},${lon + delta},${lat - delta}`;
  const headers = { 'User-Agent': 'RESQORA/1.0 (nearby emergency lookup)' };
  const queries = [
    ['hospital', 'hospital'],
    ['police station', 'police'],
  ];
  const groups = await Promise.all(queries.map(async ([query, kind]) => {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=50&bounded=1&viewbox=${encodeURIComponent(viewbox)}&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('Map lookup unavailable');
    const rows = await response.json();
    return (rows || []).map((row) => {
      const itemLat = Number(row.lat);
      const itemLon = Number(row.lon);
      return {
        id: `nominatim/${row.place_id}`,
        kind,
        name: row.name || row.display_name?.split(',')[0] || (kind === 'hospital' ? 'Hospital' : 'Police station'),
        address: row.display_name || null,
        phone: row.phone || row['contact:phone'] || null,
        lat: itemLat,
        lon: itemLon,
        distance: distanceKm(lat, lon, itemLat, itemLon),
      };
    }).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon) && item.distance <= radius / 1000);
  }));
  return groups.flat().sort((a, b) => a.distance - b.distance).slice(0, 12);
}

export async function getNearestHelp(lat, lon, radius = 2000) {
  const data = await authFetch(`/nearby/help?lat=${lat}&lon=${lon}&radius=${radius}`);
  if (data?.fallback || data?.failed) {
    try {
      const places = await lookupNearbyFacilities(lat, lon, radius);
      if (places.length) return { ...data, places, failed: false, fallback: true };
    } catch {
      // Keep the server-provided emergency hotline fallback.
    }
  }
  return data;
}

// --- SAFETY TIMER ----------------------------------------------------------
// Check in before it runs out, or the server raises an SOS for you.

function normalizeTimer(timer) {
  if (!timer || typeof timer !== 'object') return null;
  return {
    ...timer,
    startedAt: timer.startedAt || timer.started_at,
    expiresAt: timer.expiresAt || timer.expires_at,
  };
}

export async function getTimer() {
  const data = await authFetch('/timer');
  return {
    ...data,
    timer: normalizeTimer(data.timer),
  };
}

export async function startTimer(minutes, note) {
  const data = await authFetch('/timer/start', {
    method: 'POST',
    body: JSON.stringify({ minutes, note }),
  });
  return { ...data, timer: normalizeTimer(data.timer) };
}

export async function checkInTimer() {
  return { ...(await authFetch('/timer/checkin', { method: 'POST' })), timer: null };
}

export async function cancelTimer() {
  return { ...(await authFetch('/timer/cancel', { method: 'POST' })), timer: null };
}

export async function extendTimer(minutes = 10) {
  const data = await authFetch('/timer/extend', {
    method: 'POST',
    body: JSON.stringify({ minutes }),
  });
  return { ...data, timer: normalizeTimer(data.timer || { expires_at: data.expires_at }) };
}

// --- EMERGENCY CONTACTS ----------------------------------------------------

export async function getContacts() {
  return await authFetch('/contacts');
}

export async function addContact(name, phone) {
  const data = await authFetch('/contacts', {
    method: 'POST',
    body: JSON.stringify({ name, phone }),
  });
  return {
    ...data,
    contacts: Array.isArray(data.contacts) ? data.contacts : (data.contact ? [data.contact] : []),
  };
}

export async function removeContact(id) {
  const data = await authFetch(`/contacts/${id}`, { method: 'DELETE' });
  return { ...data, contacts: Array.isArray(data.contacts) ? data.contacts : [] };
}

// --- SOS -------------------------------------------------------------------

function buildImageBody(image) {
  if (!image?.dataUri && !image?.url) return null;
  return {
    dataUri: image.dataUri,
    url: image.url,
    mimeType: image.mimeType,
    fileName: image.fileName,
  };
}

/**
 * Sends live location + the default help message (+ one optional photo) to
 * everyone inside `range` km of the caller.
 */
export async function triggerSOS(
  lat,
  lon,
  message = DEFAULT_SOS_MESSAGE,
  range = DEFAULT_SOS_RANGE_KM,
  image = null
) {
  const payload = {
    lat,
    lon,
    message: message || DEFAULT_SOS_MESSAGE,
    range: range || DEFAULT_SOS_RANGE_KM,
  };

  const imageBody = buildImageBody(image);
  if (imageBody) payload.image = imageBody;

  return await authFetch('/sos/trigger', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Attaches or replaces the photo on an SOS that is already live. */
export async function attachSOSImage(sosId, image) {
  const imageBody = buildImageBody(image);
  if (!imageBody) throw new Error('No image selected');
  return await authFetch(`/sos/${sosId}/image`, {
    method: 'POST',
    body: JSON.stringify({ image: imageBody }),
  });
}

/**
 * Emergencies near you that are still running and still need you. Read on
 * launch and on every return to the foreground, so an alert that arrived
 * while the app was closed is not lost.
 */
export async function getIncomingSOS() {
  return await authFetch('/sos/incoming');
}

/** Message, photo, victim and responder list for one SOS. */
export async function getSOSDetails(sosId) {
  return await authFetch(`/sos/${sosId}`);
}

export async function respondToSOS(sosId) {
  return await authFetch(`/sos/${sosId}/respond`, { method: 'POST' });
}

/** Tell the victim you are not coming, so they stop counting on you. */
export async function withdrawFromSOS(sosId) {
  return await authFetch(`/sos/${sosId}/withdraw`, { method: 'POST' });
}

export async function markArrived(sosId) {
  return await authFetch(`/sos/${sosId}/arrived`, { method: 'POST' });
}

export async function endSOS(sosId) {
  return await authFetch(`/sos/${sosId}/end`, { method: 'POST' });
}

/** Ends any SOS still running for you. The way out of a stuck SOS state. */
export async function clearMyActiveSOS() {
  return await authFetch('/sos/mine/clear', { method: 'POST' });
}

export async function getActiveSOS() {
  return await authFetch('/sos/active');
}

export async function getNearbyUsers(lat, lon, range = DEFAULT_SOS_RANGE_KM) {
  return await authFetch(`/nearby?lat=${lat}&lon=${lon}&range=${range}`);
}

export async function updateLocation(lat, lon) {
  return await authFetch('/user/location', {
    method: 'POST',
    body: JSON.stringify({ lat, lon }),
  });
}

export async function updatePushToken(token) {
  return await authFetch('/user/push-token', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}
