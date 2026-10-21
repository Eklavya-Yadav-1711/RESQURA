import { pingServer, getSocket } from './api';

// One connectivity check for the whole app.
//
// Three tab screens stay mounted at once, so a per-screen poller meant three
// requests every cycle and three banners that could disagree — which showed up
// as the layout jumping in and out. This runs a single timer no matter how
// many things are listening, and only flips to "offline" after two failures in
// a row so a one-off slow request cannot make the screen flicker.

const CHECK_MS = 20000;
const FAILURES_BEFORE_OFFLINE = 2;

let listeners = new Set();
let timer = null;
let failures = 0;
let state = { online: true, checking: false };

function publish(next) {
  const changed = next.online !== state.online || next.checking !== state.checking;
  state = next;
  if (changed) listeners.forEach((fn) => fn(state));
}

async function check() {
  // A live socket already proves the server is there.
  if (getSocket()?.connected) {
    failures = 0;
    publish({ online: true, checking: false });
    return true;
  }

  const ok = await pingServer();
  if (ok) {
    failures = 0;
    publish({ online: true, checking: false });
    return true;
  }

  failures += 1;
  publish({ online: failures < FAILURES_BEFORE_OFFLINE, checking: false });
  return false;
}

function start() {
  if (timer) return;
  check();
  timer = setInterval(check, CHECK_MS);
}

function stop() {
  clearInterval(timer);
  timer = null;
}

/** Calls back with { online, checking } and returns an unsubscribe function. */
export function subscribeConnection(listener) {
  listeners.add(listener);
  listener(state);
  if (listeners.size === 1) start();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** Manual retry from the banner. */
export async function recheckConnection() {
  publish({ ...state, checking: true });
  const ok = await check();
  if (!ok) getSocket()?.connect?.();
  return ok;
}

export function getConnectionState() {
  return state;
}
