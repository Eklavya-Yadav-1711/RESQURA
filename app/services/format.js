// Shared formatting so distances, clocks and dates read the same everywhere.

/** SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC. */
export function parseServerDate(value) {
  if (!value) return null;
  const text = String(value).trim().replace(' ', 'T');
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasTimezone ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatKm(value) {
  if (!Number.isFinite(value)) return 'nearby';
  return value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(1)} km`;
}

/** Seconds to m:ss / h:mm:ss for live timers. */
export function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatDuration(start, end) {
  const from = parseServerDate(start);
  const to = parseServerDate(end);
  if (!from || !to) return null;
  const minutes = Math.round((to - from) / 60000);
  return minutes < 1 ? 'Under a minute' : `${minutes} min`;
}

export function formatTime(value) {
  const date = parseServerDate(value);
  return date ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
}

export function formatDay(value) {
  const date = parseServerDate(value);
  if (!date) return '';

  const today = new Date();
  const isSameDay = (a, b) => a.toDateString() === b.toDateString();
  if (isSameDay(date, today)) return 'Today';

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
