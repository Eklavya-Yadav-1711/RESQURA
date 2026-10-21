// End-to-end check of the RESQORA backend: auth → location → SOS with image
// → nearby delivery → respond → arrive → end → history.
const { io } = require('socket.io-client');

const BASE = process.env.BASE || 'http://127.0.0.1:3999';
const results = [];
let failures = 0;

function check(name, ok, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function connect(userId) {
  return new Promise((resolve) => {
    const socket = io(BASE, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('authenticate', { userId }));
    socket.on('authenticated', () => resolve(socket));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls until `probe` returns something truthy, or gives up. */
async function waitFor(probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await wait(500);
  }
  return null;
}

/** Backdates the running timer so the server's sweep sees it as due. */
function expireTimersNow(userId) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.DB_PATH);
  db.prepare(
    "UPDATE safety_timers SET expires_at = datetime('now', '-1 minutes') "
    + "WHERE user_id = ? AND status = 'running'"
  ).run(userId);
  db.close();
}

// 1x1 red PNG
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const stamp = Date.now();
  const victimPhone = `9000${stamp}`.slice(0, 12);
  const nearPhone = `9001${stamp}`.slice(0, 12);
  const farPhone = `9002${stamp}`.slice(0, 12);

  // ── config
  const cfg = await api('/config');
  check('GET /config exposes 2 km default radius', cfg.data?.defaultRangeKm === 2, `got ${cfg.data?.defaultRangeKm}`);
  check('GET /config exposes default message',
    cfg.data?.defaultMessage === 'I am here. Please come and help me.', cfg.data?.defaultMessage);

  // ── register three users
  const victim = (await api('/auth/register', { method: 'POST', body: { name: 'Victim V', phone: victimPhone, password: 'pass123' } })).data;
  const near = (await api('/auth/register', { method: 'POST', body: { name: 'Near N', phone: nearPhone, password: 'pass123' } })).data;
  const far = (await api('/auth/register', { method: 'POST', body: { name: 'Far F', phone: farPhone, password: 'pass123' } })).data;
  check('register 3 users', Boolean(victim?.token && near?.token && far?.token));

  const shortPw = await api('/auth/register', { method: 'POST', body: { name: 'X', phone: `1${stamp}`, password: '1' } });
  check('register rejects short password', shortPw.status === 400, shortPw.data?.error);

  const dup = await api('/auth/register', { method: 'POST', body: { name: 'X', phone: victimPhone, password: 'pass123' } });
  check('register rejects duplicate phone', dup.status === 400, dup.data?.error);

  const badLogin = await api('/auth/login', { method: 'POST', body: { phone: victimPhone, password: 'nope' } });
  check('login rejects wrong password', badLogin.status === 400);

  const noAuth = await api('/sos/active');
  check('protected route needs a token', noAuth.status === 401);

  // ── sockets + locations
  // Victim at (28.6139, 77.2090). Near ≈ 0.9 km away, Far ≈ 5.5 km away.
  const victimLoc = { lat: 28.6139, lon: 77.2090 };
  const nearLoc = { lat: 28.6219, lon: 77.2090 };
  const farLoc = { lat: 28.6639, lon: 77.2090 };

  const victimSocket = await connect(victim.user.id);
  let onlineEvent = null;
  victimSocket.on('online_count', (d) => { onlineEvent = d; });

  const nearSocket = await connect(near.user.id);
  const farSocket = await connect(far.user.id);
  await wait(300);
  check('live online_count also leaves you out',
    onlineEvent && onlineEvent.count === onlineEvent.total - 1,
    onlineEvent);

  const alerts = { near: null, far: null };
  nearSocket.on('sos_alert', (d) => { alerts.near = d; });
  farSocket.on('sos_alert', (d) => { alerts.far = d; });

  const victimEvents = { coming: null, arrived: null, responderLoc: null };
  victimSocket.on('responder_coming', (d) => { victimEvents.coming = d; });
  victimSocket.on('responder_arrived', (d) => { victimEvents.arrived = d; });
  victimSocket.on('responder_location', (d) => { victimEvents.responderLoc = d; });

  const nearEvents = { victimLoc: null, ended: null, image: null };
  nearSocket.on('victim_location_update', (d) => { nearEvents.victimLoc = d; });
  nearSocket.on('sos_ended', (d) => { nearEvents.ended = d; });
  nearSocket.on('sos_image', (d) => { nearEvents.image = d; });

  victimSocket.emit('location_update', victimLoc);
  nearSocket.emit('location_update', nearLoc);
  farSocket.emit('location_update', farLoc);
  await wait(400);

  const stats = await api('/stats');
  check('online count tracks sockets', stats.data.onlineCount >= 3, `got ${stats.data.onlineCount}`);

  // You are not "someone online" to yourself.
  const mine = await api('/stats', { token: victim.token });
  check('online count leaves you out of it',
    mine.data.othersOnline === mine.data.onlineCount - 1,
    `others ${mine.data.othersOnline} of ${mine.data.onlineCount}`);

  const anon = await api('/stats');
  check('anonymous stats still report everyone',
    anon.data.othersOnline === anon.data.onlineCount, anon.data);

  const nearby = await api(`/nearby?lat=${victimLoc.lat}&lon=${victimLoc.lon}&range=2`, { token: victim.token });
  const nearbyIds = (nearby.data.users || []).map((u) => u.id);
  check('/nearby includes the user 0.9 km away', nearbyIds.includes(near.user.id));
  check('/nearby excludes the user 5.5 km away', !nearbyIds.includes(far.user.id));
  check('/nearby excludes self', !nearbyIds.includes(victim.user.id));

  // ── trigger SOS with default message + image
  const trigger = await api('/sos/trigger', {
    method: 'POST',
    token: victim.token,
    body: {
      lat: victimLoc.lat,
      lon: victimLoc.lon,
      image: { dataUri: PNG, mimeType: 'image/png', fileName: 'scene.png' },
    },
  });
  check('POST /sos/trigger succeeds', trigger.status === 200, JSON.stringify(trigger.data).slice(0, 120));
  check('SOS falls back to the default message',
    trigger.data.message === 'I am here. Please come and help me.', trigger.data.message);
  check('SOS defaults to a 2 km radius', trigger.data.range === 2, `got ${trigger.data.range}`);
  check('image stored as a URL, not base64',
    typeof trigger.data.imageUrl === 'string' && trigger.data.imageUrl.includes('/uploads/') && !trigger.data.imageUrl.startsWith('data:'),
    trigger.data.imageUrl);

  const sosId = trigger.data.sosId;
  await wait(500);

  check('nearby user received sos_alert', Boolean(alerts.near), 'no alert');
  check('far user did NOT receive sos_alert', !alerts.far);
  check('alert carries the location', alerts.near?.location?.lat === victimLoc.lat);
  check('alert carries the default message',
    alerts.near?.message === 'I am here. Please come and help me.');
  check('alert carries the image url', Boolean(alerts.near?.imageUrl?.includes('/uploads/')), alerts.near?.imageUrl);
  check('alert carries the distance', typeof alerts.near?.distance === 'number' && alerts.near.distance < 2,
    String(alerts.near?.distance));

  // ── image is actually downloadable
  const imgRes = await fetch(alerts.near.imageUrl);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  check('image is served over http', imgRes.status === 200 && imgBuf.length > 0,
    `${imgRes.status}, ${imgBuf.length} bytes, ${imgRes.headers.get('content-type')}`);

  // ── duplicate SOS blocked
  const dupSOS = await api('/sos/trigger', { method: 'POST', token: victim.token, body: victimLoc });
  check('second SOS while one is active is rejected', dupSOS.status === 400, dupSOS.data?.error);

  // ── details endpoint + access control
  const details = await api(`/sos/${sosId}`, { token: near.token });
  check('responder can read SOS details', details.status === 200 && details.data.sos.hasImage === true);
  check('details include victim name', details.data?.victim?.name === 'Victim V');
  const forbidden = await api(`/sos/${sosId}`, { token: far.token });
  check('out-of-range user cannot read SOS details', forbidden.status === 403, String(forbidden.status));

  // ── replace image mid-emergency
  const newImg = await api(`/sos/${sosId}/image`, {
    method: 'POST',
    token: victim.token,
    body: { image: { dataUri: PNG, mimeType: 'image/png', fileName: 'second.png' } },
  });
  check('victim can attach a new image mid-SOS', newImg.status === 200, newImg.data?.error);
  await wait(300);
  check('responder is notified of the new image', Boolean(nearEvents.image?.imageUrl));
  const notVictimImg = await api(`/sos/${sosId}/image`, {
    method: 'POST', token: near.token, body: { image: { dataUri: PNG } },
  });
  check('non-victim cannot attach an image', notVictimImg.status === 403);

  const badImage = await api(`/sos/${sosId}/image`, {
    method: 'POST', token: victim.token, body: { image: { dataUri: 'data:text/plain;base64,aGk=' } },
  });
  check('non-image data URI is rejected', badImage.status === 415 || badImage.status === 400, String(badImage.status));

  // ── respond / arrive
  const selfRespond = await api(`/sos/${sosId}/respond`, { method: 'POST', token: victim.token });
  check('victim cannot respond to their own SOS', selfRespond.status === 400);

  const respond = await api(`/sos/${sosId}/respond`, { method: 'POST', token: near.token });
  check('responder can accept the SOS', respond.status === 200, respond.data?.error);
  await wait(300);
  check('victim notified that help is coming', victimEvents.coming?.responder?.name === 'Near N');

  nearSocket.emit('responder_location_update', { sosId, lat: 28.6180, lon: 77.2090 });
  await wait(300);
  check('victim receives live responder location + distance',
    typeof victimEvents.responderLoc?.distance === 'number', String(victimEvents.responderLoc?.distance));

  victimSocket.emit('location_update', { lat: 28.6140, lon: 77.2091 });
  await wait(300);
  check('responder receives live victim location', nearEvents.victimLoc?.lat === 28.6140);

  const strangerArrive = await api(`/sos/${sosId}/arrived`, { method: 'POST', token: far.token });
  check('non-responder cannot mark arrived', strangerArrive.status === 403);

  const arrived = await api(`/sos/${sosId}/arrived`, { method: 'POST', token: near.token });
  check('responder can mark arrived', arrived.status === 200);
  await wait(300);
  check('victim notified of arrival', victimEvents.arrived?.responder?.name === 'Near N');

  // ── multi-device delivery
  const secondDevice = await connect(near.user.id);
  let secondDeviceGotEnd = false;
  secondDevice.on('sos_ended', () => { secondDeviceGotEnd = true; });
  await wait(200);

  // ── end
  const wrongEnd = await api(`/sos/${sosId}/end`, { method: 'POST', token: near.token });
  check('only the victim can end the SOS', wrongEnd.status === 403);

  const end = await api(`/sos/${sosId}/end`, { method: 'POST', token: victim.token });
  check('victim ends the SOS', end.status === 200);
  await wait(400);
  check('responder notified the SOS ended', nearEvents.ended?.sosId === sosId);
  check('second device of the same user also notified', secondDeviceGotEnd);

  // ── history + stats
  const history = await api('/history', { token: victim.token });
  const entry = history.data.history.find((h) => h.id === sosId);
  check('history records the SOS', Boolean(entry));
  check('history keeps the image', Boolean(entry?.imageUrl?.includes('/uploads/')), entry?.imageUrl);
  check('history keeps the message', entry?.message === 'I am here. Please come and help me.');
  check('history lists the responder', entry?.responders?.some((r) => r.name === 'Near N'));
  check('history marks it resolved', entry?.status === 'resolved');

  const pStats = await api('/profile/stats', { token: near.token });
  check('profile stats count times helped', pStats.data.timesHelped >= 1, String(pStats.data.timesHelped));

  const afterEnd = await api('/sos/active', { token: victim.token });
  check('no active SOS after ending', afterEnd.data.active === false);

  // ── the victim can trigger again once resolved
  const second = await api('/sos/trigger', { method: 'POST', token: victim.token, body: victimLoc });
  check('a new SOS can start after the previous resolved', second.status === 200, second.data?.error);
  await api(`/sos/${second.data.sosId}/end`, { method: 'POST', token: victim.token });

  // ── offline user still gets an alerted row (push path)
  farSocket.disconnect();
  await wait(300);
  const third = await api('/sos/trigger', {
    method: 'POST', token: victim.token, body: { ...victimLoc, range: 10 },
  });
  check('range is honoured when given explicitly', third.data.range === 10, String(third.data.range));
  check('offline in-range users are still recorded as alerted',
    third.data.alertedUsers.some((u) => u.id === far.user.id));
  check('notifiedOnlineCount counts only live devices',
    third.data.notifiedOnlineCount < third.data.alertedCount,
    `${third.data.notifiedOnlineCount}/${third.data.alertedCount}`);
  await api(`/sos/${third.data.sosId}/end`, { method: 'POST', token: victim.token });

  // --- an alert that fires while the responder's app is closed --------------
  // This is the "notification arrived but the app showed nothing" case: the
  // responder must be able to catch up on reopening.
  nearSocket.disconnect();
  secondDevice.disconnect();
  await wait(400);

  const missed = await api('/sos/trigger', {
    method: 'POST', token: victim.token,
    body: { ...victimLoc, image: { dataUri: PNG, mimeType: 'image/png' } },
  });
  check('SOS can be raised while the responder is offline', missed.status === 200, missed.data?.error);
  const missedId = missed.data.sosId;

  const incoming = await api('/sos/incoming', { token: near.token });
  const pending = incoming.data?.alerts?.find((a) => a.sosId === missedId);
  check('offline responder can read the missed alert on reopening', Boolean(pending), incoming.data);
  check('missed alert carries the message', pending?.message === 'I am here. Please come and help me.');
  check('missed alert carries the location', pending?.location?.lat === victimLoc.lat);
  check('missed alert carries the photo', Boolean(pending?.imageUrl?.includes('/uploads/')), pending?.imageUrl);
  check('missed alert carries the distance', typeof pending?.distance === 'number', String(pending?.distance));

  // Reconnecting replays it over the socket too, flagged so the app can show
  // it without re-running the siren.
  let replayed = null;
  const reconnected = await connect(near.user.id);
  reconnected.on('sos_alert', (d) => { replayed = d; });
  await wait(600);
  check('reconnecting replays the missed alert over the socket',
    replayed?.sosId === missedId, replayed && { sosId: replayed.sosId });
  check('replayed alert is marked as a resume', replayed?.resumed === true, replayed?.resumed);

  const victimIncoming = await api('/sos/incoming', { token: victim.token });
  check('your own SOS never appears as an incoming alert',
    !(victimIncoming.data?.alerts || []).some((a) => a.sosId === missedId), victimIncoming.data);

  await api(`/sos/${missedId}/arrived`, { method: 'POST', token: near.token });
  const afterArrival = await api('/sos/incoming', { token: near.token });
  check('an alert you already answered stops being pending',
    !(afterArrival.data?.alerts || []).some((a) => a.sosId === missedId), afterArrival.data);

  await api(`/sos/${missedId}/end`, { method: 'POST', token: victim.token });
  reconnected.disconnect();

  // --- "I can't make it" must reach the victim ------------------------------
  const withdrawSOS = await api('/sos/trigger', { method: 'POST', token: victim.token, body: victimLoc });
  const wId = withdrawSOS.data.sosId;

  const nearSocket2 = await connect(near.user.id);
  let left = null;
  victimSocket.on('responder_left', (d) => { left = d; });

  await api(`/sos/${wId}/respond`, { method: 'POST', token: near.token });
  await wait(250);

  const withdrew = await api(`/sos/${wId}/withdraw`, { method: 'POST', token: near.token });
  check('responder can withdraw', withdrew.status === 200, withdrew.data?.error);
  await wait(300);
  check('victim is told the responder is not coming', left?.responder?.name === 'Near N', left);

  const afterWithdraw = await api(`/sos/${wId}`, { token: victim.token });
  const wRow = afterWithdraw.data?.responders?.find((r) => r.id === near.user.id);
  check('withdrawn responder is no longer responding', wRow?.status === 'declined', wRow?.status);

  const pendingAfterWithdraw = await api('/sos/incoming', { token: near.token });
  check('a declined alert stops nagging you',
    !(pendingAfterWithdraw.data?.alerts || []).some((a) => a.sosId === wId), pendingAfterWithdraw.data);

  const changedMind = await api(`/sos/${wId}/respond`, { method: 'POST', token: near.token });
  check('you can still change your mind after declining', changedMind.status === 200, changedMind.data?.error);

  const arrivedAfter = await api(`/sos/${wId}/arrived`, { method: 'POST', token: near.token });
  check('and still mark arrived', arrivedAfter.status === 200);
  const cannotWithdrawNow = await api(`/sos/${wId}/withdraw`, { method: 'POST', token: near.token });
  check('cannot withdraw once you have arrived', cannotWithdrawNow.status === 400, String(cannotWithdrawNow.status));

  const strangerWithdraw = await api(`/sos/${wId}/withdraw`, { method: 'POST', token: far.token });
  check('a stranger cannot withdraw from an SOS', strangerWithdraw.status === 403, String(strangerWithdraw.status));

  await api(`/sos/${wId}/end`, { method: 'POST', token: victim.token });
  nearSocket2.disconnect();

  // --- emergency contacts + the public tracking link ------------------------
  const noContacts = await api('/contacts', { token: victim.token });
  check('a new account starts with no contacts', noContacts.data?.contacts?.length === 0, noContacts.data);

  const badContact = await api('/contacts', { method: 'POST', token: victim.token, body: { name: 'Mum', phone: 'abc' } });
  check('a contact needs a real phone number', badContact.status === 400, badContact.data?.error);

  const added = await api('/contacts', { method: 'POST', token: victim.token, body: { name: 'Mum', phone: '+91 90000 11111' } });
  check('a contact can be added', added.data?.contacts?.length === 1, added.data);

  await api('/contacts', { method: 'POST', token: victim.token, body: { name: 'Mum again', phone: '+91 90000 11111' } });
  const dupes = await api('/contacts', { token: victim.token });
  check('the same number is not stored twice', dupes.data.contacts.length === 1, dupes.data.contacts);

  const tracked = await api('/sos/trigger', {
    method: 'POST', token: victim.token,
    body: { ...victimLoc, image: { dataUri: PNG, mimeType: 'image/png' } },
  });
  const trackedId = tracked.data.sosId;
  check('an SOS comes back with a share link',
    typeof tracked.data.shareUrl === 'string' && tracked.data.shareUrl.includes('/t/'), tracked.data.shareUrl);
  check('the SOS response carries your contacts to text',
    tracked.data.contacts?.[0]?.phone === '+91 90000 11111', tracked.data.contacts);

  const shareToken = tracked.data.shareUrl.split('/t/')[1];

  const pageRes = await fetch(`${BASE}/t/${shareToken}`);
  const pageHtml = await pageRes.text();
  check('the tracking page loads for anyone, with no token',
    pageRes.status === 200 && pageHtml.includes('RESQORA'), String(pageRes.status));
  check('the page is a real map page', pageHtml.includes('leaflet') && pageHtml.includes('/data'));

  const liveRes = await fetch(`${BASE}/t/${shareToken}/data`);
  const live = await liveRes.json();
  check('tracking data shows the emergency as live', live.status === 'active', live.status);
  check('tracking data carries the position', live.lat === victimLoc.lat && live.lon === victimLoc.lon, live);
  check('tracking data carries the message and photo',
    Boolean(live.message) && Boolean(live.imageUrl?.includes('/uploads/')), live.imageUrl);
  check('tracking data never leaks the phone number',
    !JSON.stringify(live).includes(victimPhone), Object.keys(live).join(','));

  const nonsense = await fetch(`${BASE}/t/not-a-real-token/data`);
  check('an invalid tracking link is rejected', nonsense.status === 404, String(nonsense.status));

  await api(`/sos/${trackedId}/end`, { method: 'POST', token: victim.token });
  const afterTrackedEnd = await (await fetch(`${BASE}/t/${shareToken}/data`)).json();
  check('the link reports the emergency as over once ended',
    afterTrackedEnd.status === 'resolved', afterTrackedEnd.status);

  const removed = await api(`/contacts/${added.data.contacts[0].id}`, { method: 'DELETE', token: victim.token });
  check('a contact can be removed', removed.data?.contacts?.length === 0, removed.data);

  // --- the escape hatch for a stuck SOS -------------------------------------
  const stuck = await api('/sos/trigger', { method: 'POST', token: victim.token, body: victimLoc });
  const stuckId = stuck.data.sosId;

  const blocked = await api('/sos/trigger', { method: 'POST', token: victim.token, body: victimLoc });
  check('a second SOS is blocked while one runs', blocked.status === 400);
  check('the block tells you which SOS is in the way', blocked.data?.sos?.id === stuckId, blocked.data?.sos);

  // nearSocket was disconnected earlier in this suite; use a live one.
  const watcher = await connect(near.user.id);
  let clearedNotice = null;
  watcher.on('sos_ended', (d) => { if (d.sosId === stuckId) clearedNotice = d; });
  await wait(200);

  const cleared = await api('/sos/mine/clear', { method: 'POST', token: victim.token });
  check('clearing closes the stuck SOS', cleared.data?.cleared === 1, cleared.data);
  await wait(300);
  check('responders are told a cleared SOS ended', clearedNotice?.sosId === stuckId, clearedNotice);

  const nowFree = await api('/sos/active', { token: victim.token });
  check('no SOS is active after clearing', nowFree.data.active === false, nowFree.data);

  const resent = await api('/sos/trigger', { method: 'POST', token: victim.token, body: victimLoc });
  check('a new SOS can be sent right after clearing', resent.status === 200, resent.data?.error);
  await api('/sos/mine/clear', { method: 'POST', token: victim.token });

  const nothing = await api('/sos/mine/clear', { method: 'POST', token: victim.token });
  check('clearing with nothing running is harmless', nothing.data?.cleared === 0, nothing.data);
  watcher.disconnect();

  // --- nearest official help (OpenStreetMap) --------------------------------
  const help = await api(`/nearby/help?lat=${victimLoc.lat}&lon=${victimLoc.lon}`, { token: victim.token });
  check('nearest-help answers', help.status === 200, help.data?.error);
  check('emergency hotlines are always returned',
    help.data?.hotlines?.some((h) => h.primary && h.number), help.data?.hotlines);
  check('places come back in a usable shape',
    Array.isArray(help.data?.places)
    && help.data.places.every((p) => p.name && p.kind && Number.isFinite(p.distance)),
    `${help.data?.places?.length} place(s), failed=${help.data?.failed}`);
  check('police stations are listed before hospitals',
    help.data.places.every((p, i, all) =>
      i === 0 || !(p.kind === 'police' && all[i - 1].kind === 'hospital')),
    help.data.places.map((p) => p.kind).join(','));

  const badHelp = await api('/nearby/help?lat=abc&lon=77', { token: victim.token });
  check('nearest-help rejects a bad position', badHelp.status === 400, String(badHelp.status));

  const cachedHelp = await api(`/nearby/help?lat=${victimLoc.lat}&lon=${victimLoc.lon}`, { token: victim.token });
  check('a second lookup is served from cache',
    cachedHelp.data?.cached === true || cachedHelp.data?.failed === true,
    `cached=${cachedHelp.data?.cached} failed=${cachedHelp.data?.failed}`);

  // --- safety timer ---------------------------------------------------------
  const idle = await api('/timer', { token: victim.token });
  check('no timer runs by default', idle.data?.timer === null, idle.data);

  const badTimer = await api('/timer/start', { method: 'POST', token: victim.token, body: { minutes: 0 } });
  check('a timer needs a real duration', badTimer.status === 400, badTimer.data?.error);

  const started = await api('/timer/start', {
    method: 'POST', token: victim.token, body: { minutes: 20, note: 'Walking home' },
  });
  check('a timer can be started', started.data?.timer?.status === 'running', started.data);
  check('the timer keeps your note', started.data.timer.note === 'Walking home');

  const secondTimer = await api('/timer/start', { method: 'POST', token: victim.token, body: { minutes: 10 } });
  check('only one timer runs at a time', secondTimer.status === 400, secondTimer.data?.error);

  const extended = await api('/timer/extend', { method: 'POST', token: victim.token, body: { minutes: 10 } });
  check('a timer can be extended',
    new Date(extended.data.timer.expiresAt + 'Z') > new Date(started.data.timer.expiresAt + 'Z'),
    { was: started.data.timer.expiresAt, now: extended.data.timer.expiresAt });

  const safe = await api('/timer/checkin', { method: 'POST', token: victim.token });
  check('checking in marks you safe', safe.data?.timer?.status === 'safe', safe.data);

  const afterCheckin = await api('/timer', { token: victim.token });
  check('a finished timer stops being current', afterCheckin.data.timer === null, afterCheckin.data);

  // The real test: a deadline that has already passed must raise a full SOS.
  let timerAlert = null;
  const timerWatcher = await connect(near.user.id);
  timerWatcher.on('sos_alert', (d) => { if (!timerAlert) timerAlert = d; });
  await wait(200);

  await api('/timer/start', { method: 'POST', token: victim.token, body: { minutes: 1, note: 'Late walk' } });
  expireTimersNow(victim.user.id);

  // The sweep runs every 15s; wait for it rather than poking internals.
  const fired = await waitFor(async () => {
    const active = await api('/sos/active', { token: victim.token });
    return active.data.active ? active.data : null;
  }, 20000);

  check('a missed check-in raises an SOS by itself', Boolean(fired),
    fired ? `SOS ${fired.sos.id}` : 'no SOS appeared');
  check('the automatic SOS explains itself',
    fired?.sos?.message?.includes('did not check in'), fired?.sos?.message);
  check('the automatic SOS mentions what you were doing',
    fired?.sos?.message?.includes('Late walk'), fired?.sos?.message);
  check('nearby people are alerted by the automatic SOS', timerAlert?.sosId === fired?.sos?.id,
    { alerted: timerAlert?.sosId, sos: fired?.sos?.id });

  const expiredTimer = await api('/timer', { token: victim.token });
  check('the expired timer stops running', expiredTimer.data.timer === null, expiredTimer.data);

  await api('/sos/mine/clear', { method: 'POST', token: victim.token });
  timerWatcher.disconnect();

  [victimSocket, nearSocket, farSocket, secondDevice].forEach((s) => s.disconnect());
  await wait(300);

  console.log('\n' + results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('E2E crashed:', err);
  console.log(results.join('\n'));
  process.exit(1);
});
