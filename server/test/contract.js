// Checks that every field the redesigned screens read is actually present in
// the server's responses. Guards against UI/API drift.
const { io } = require('socket.io-client');

const BASE = process.env.BASE || 'http://127.0.0.1:3999';
const results = [];
let failures = 0;

function check(screen, field, ok, got) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${screen} reads ${field}${ok ? '' : ` — got ${JSON.stringify(got)}`}`);
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
  return { status: res.status, data: await res.json().catch(() => null) };
}

const connect = (userId) => new Promise((resolve) => {
  const socket = io(BASE, { transports: ['websocket'] });
  socket.on('connect', () => socket.emit('authenticate', { userId }));
  socket.on('authenticated', () => resolve(socket));
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const t = Date.now();
  const victim = (await api('/auth/register', { method: 'POST', body: { name: 'Contract V', phone: `81${t}`.slice(0, 12), password: 'pass123' } })).data;
  const helper = (await api('/auth/register', { method: 'POST', body: { name: 'Contract H', phone: `82${t}`.slice(0, 12), password: 'pass123' } })).data;

  const vs = await connect(victim.user.id);
  const hs = await connect(helper.user.id);
  vs.emit('location_update', { lat: 19.076, lon: 72.8777 });
  hs.emit('location_update', { lat: 19.079, lon: 72.8777 });
  await wait(400);

  // --- home ---------------------------------------------------------------
  const stats = await api('/stats', { token: victim.token });
  check('home', 'othersOnline (self excluded)', typeof stats.data?.othersOnline === 'number', stats.data);

  const nearby = await api(`/nearby?lat=19.076&lon=72.8777&range=2`, { token: victim.token });
  const person = nearby.data?.users?.[0];
  check('home', 'users[].id/name/distance',
    Boolean(person && person.id && person.name && typeof person.distance === 'number'), person);

  const idle = await api('/sos/active', { token: victim.token });
  check('home', 'active === false when idle', idle.data?.active === false, idle.data);

  // --- sos-trigger --------------------------------------------------------
  const trigger = await api('/sos/trigger', {
    method: 'POST', token: victim.token,
    body: { lat: 19.076, lon: 72.8777, image: { dataUri: PNG, mimeType: 'image/png' } },
  });
  check('sos-trigger', 'result.sosId', Number.isInteger(trigger.data?.sosId), trigger.data);
  check('sos-trigger', 'result.alertedCount', typeof trigger.data?.alertedCount === 'number', trigger.data?.alertedCount);
  const sosId = trigger.data.sosId;

  await api(`/sos/${sosId}/respond`, { method: 'POST', token: helper.token });
  hs.emit('responder_location_update', { sosId, lat: 19.078, lon: 72.8777 });
  await wait(300);

  // --- sos-active ---------------------------------------------------------
  const active = await api('/sos/active', { token: victim.token });
  const sos = active.data?.sos;
  check('sos-active', 'sos.id', Number.isInteger(sos?.id), sos?.id);
  check('sos-active', 'sos.message', typeof sos?.message === 'string' && sos.message.length > 0, sos?.message);
  check('sos-active', 'sos.location.lat/lon',
    typeof sos?.location?.lat === 'number' && typeof sos?.location?.lon === 'number', sos?.location);
  check('sos-active', 'sos.started_at', Boolean(sos?.started_at), sos?.started_at);
  check('sos-active', 'sos.imageUrl / sos.image.url',
    typeof sos?.imageUrl === 'string' && typeof sos?.image?.url === 'string', sos?.image);

  const responder = active.data?.responders?.[0];
  check('sos-active', 'responders[].id/name/status',
    Boolean(responder?.id && responder?.name && responder?.status), responder);
  check('sos-active', 'responders[].latitude/longitude',
    typeof responder?.latitude === 'number' && typeof responder?.longitude === 'number', responder);

  const attach = await api(`/sos/${sosId}/image`, {
    method: 'POST', token: victim.token, body: { image: { dataUri: PNG, mimeType: 'image/png' } },
  });
  check('sos-active', 'attachSOSImage -> imageUrl',
    typeof attach.data?.imageUrl === 'string' && attach.data.imageUrl.startsWith('http'), attach.data?.imageUrl);

  // --- responder-nav ------------------------------------------------------
  const details = await api(`/sos/${sosId}`, { token: helper.token });
  check('responder-nav', 'sos.message', typeof details.data?.sos?.message === 'string', details.data?.sos?.message);
  check('responder-nav', 'sos.location.lat/lon',
    typeof details.data?.sos?.location?.lat === 'number', details.data?.sos?.location);
  check('responder-nav', 'victim.name', typeof details.data?.victim?.name === 'string', details.data?.victim);
  check('responder-nav', 'sos.image.url', typeof details.data?.sos?.image?.url === 'string', details.data?.sos?.image);

  await api(`/sos/${sosId}/end`, { method: 'POST', token: victim.token });

  // --- history ------------------------------------------------------------
  const history = await api('/history', { token: victim.token });
  const event = history.data?.history?.find((h) => h.id === sosId);
  check('history', 'history[].id/message/status', Boolean(event?.id && event.message && event.status), event && {
    id: event.id, status: event.status,
  });
  check('history', 'history[].started_at/ended_at', Boolean(event?.started_at && event?.ended_at), {
    started: event?.started_at, ended: event?.ended_at,
  });
  check('history', 'history[].hasImage + image.url',
    event?.hasImage === true && typeof event?.image?.url === 'string', event?.image);
  check('history', 'history[].responders[].id/name/status',
    Boolean(event?.responders?.[0]?.id && event.responders[0].name && event.responders[0].status),
    event?.responders);

  // --- profile ------------------------------------------------------------
  const profile = await api('/profile/stats', { token: helper.token });
  check('profile', 'sosSent/timesHelped', typeof profile.data?.sosSent === 'number' &&
    typeof profile.data?.timesHelped === 'number', profile.data);
  check('profile', 'memberSince', Boolean(profile.data?.memberSince), profile.data?.memberSince);
  check('profile', 'rangeKm', profile.data?.rangeKm === 2, profile.data?.rangeKm);

  // --- push payload the notification handler unpacks -----------------------
  const config = await api('/config');
  check('app', 'config.defaultMessage/defaultRangeKm',
    typeof config.data?.defaultMessage === 'string' && config.data?.defaultRangeKm === 2, config.data);

  vs.disconnect();
  hs.disconnect();
  await wait(200);

  console.log('\n' + results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} contract checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('Contract test crashed:', err);
  console.log(results.join('\n'));
  process.exit(1);
});
