const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_ENABLED = process.env.PUSH_ENABLED !== 'false';

function isExpoPushToken(token) {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

/**
 * Best-effort background alert for users who are in range but have no live
 * socket (app closed). Never throws — a failed push must not break an SOS.
 * Requires a development/production build; Expo Go cannot receive these.
 *
 * Expo answers with one ticket per message. A token belonging to an app that
 * was uninstalled or replaced comes back as DeviceNotRegistered, and pushing
 * to it forever silently swallows every future alert — so those are reported
 * back to the caller to be cleared.
 */
async function sendPushNotifications(messages) {
  if (!PUSH_ENABLED) return { sent: 0, skipped: messages.length, dead: [] };
  const valid = messages.filter((m) => isExpoPushToken(m.to));
  if (!valid.length) return { sent: 0, skipped: messages.length, dead: [] };

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(valid),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn('Push send failed:', res.status, await res.text().catch(() => ''));
      return { sent: 0, skipped: messages.length, dead: [] };
    }

    const body = await res.json().catch(() => ({}));
    const tickets = Array.isArray(body.data) ? body.data : [];
    const dead = [];
    let delivered = 0;

    tickets.forEach((ticket, i) => {
      if (ticket?.status === 'ok') { delivered += 1; return; }
      const reason = ticket?.details?.error;
      console.warn(`Push rejected for ${valid[i]?.to}: ${reason || ticket?.message || 'unknown'}`);
      if (reason === 'DeviceNotRegistered') dead.push(valid[i].to);
    });

    return { sent: delivered, skipped: messages.length - valid.length, dead };
  } catch (err) {
    console.warn('Push send error:', err.message);
    return { sent: 0, skipped: messages.length, dead: [] };
  }
}

/**
 * Builds one Expo push message for an SOS alert.
 * `imageUrl` must be absolute for the image to render on the device.
 */
function buildSOSPushMessage({ pushToken, victimName, distanceKm, message, imageUrl, sosId, location, rangeKm }) {
  const distanceText = Number.isFinite(distanceKm) ? `${distanceKm.toFixed(2)} km away` : 'nearby';
  return {
    to: pushToken,
    title: `🚨 ${victimName} needs help — ${distanceText}`,
    body: message,
    sound: 'default',
    priority: 'high',
    channelId: 'sos-alerts',
    ttl: 900,
    data: {
      type: 'sos_alert',
      sosId,
      victimName,
      message,
      imageUrl: imageUrl || null,
      location,
      distance: distanceKm,
      range: rangeKm,
    },
    ...(imageUrl ? { richContent: { image: imageUrl } } : {}),
  };
}

module.exports = { sendPushNotifications, buildSOSPushMessage, isExpoPushToken, PUSH_ENABLED };
