import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { updatePushToken } from './api';

// Background alerts for when the app is closed and the socket is gone.
// The device registers an Expo Push token. Supabase Edge Functions can send
// to the Expo Push API; Expo routes Android delivery through FCM, so the app
// does not need a Firebase SDK or a separate backend server for this project.

export const SOS_CHANNEL = 'sos-alerts';

// Android remote push is not part of Expo Go from SDK 53 onward. More
// importantly, loading its native module there can throw before a screen has
// rendered. Only load it in our own development/standalone build.
const isExpoGo = Constants.appOwnership === 'expo';
let notificationModule;
let notificationHandlerConfigured = false;

function getNotifications() {
  if (isExpoGo) return null;
  if (!notificationModule) notificationModule = require('expo-notifications');

  if (!notificationHandlerConfigured) {
    notificationModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    notificationHandlerConfigured = true;
  }

  return notificationModule;
}

/** An emergency channel: max importance, red light, insistent vibration. */
export async function prepareChannel() {
  if (Platform.OS !== 'android') return;
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(SOS_CHANNEL, {
      name: 'Emergency alerts',
      description: 'Someone near you needs help',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 180, 400, 180, 400],
      lightColor: '#EF4444',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      sound: 'default',
    });
  } catch {}
}

/**
 * Registers this device for push and hands the token to the server.
 *
 * Returns { token, status, reason } rather than throwing — an SOS app has to
 * keep working without push — but it reports WHY it failed so the interface
 * can say so instead of being silently unreachable.
 *
 * status: 'registered' | 'denied' | 'unsupported' | 'failed'
 */
export async function registerForPush() {
  if (isExpoGo) {
    return {
      token: null,
      status: 'unsupported',
      reason: 'Push notifications need the RESQORA APK, not Expo Go.',
    };
  }
  if (!Device.isDevice) {
    return { token: null, status: 'unsupported', reason: 'Push needs a real device.' };
  }

  try {
    const Notifications = getNotifications();
    if (!Notifications) {
      return { token: null, status: 'unsupported', reason: 'Push notifications are unavailable here.' };
    }
    await prepareChannel();

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) {
      return {
        token: null,
        status: 'denied',
        reason: 'Notifications are turned off for RESQORA in your phone settings.',
      };
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    if (!token) {
      return { token: null, status: 'failed', reason: 'This device returned no push token.' };
    }

    await updatePushToken(token);
    return { token, status: 'registered', reason: null };
  } catch (err) {
    // A standalone build without Firebase credentials lands here, as does
    // Expo Go on SDK 53+. Both are expected; neither should be silent.
    console.log('Push unavailable:', err.message);
    return {
      token: null,
      status: 'failed',
      reason: /FirebaseApp|google-services|FCM|Default FirebaseApp/i.test(err.message || '')
        ? 'This build has no Firebase credentials, so background alerts cannot be delivered to it.'
        : err.message || 'Push registration failed.',
    };
  }
}

/** Current permission state, without asking for anything. */
export async function getPushStatus() {
  if (isExpoGo) return { granted: false, canAskAgain: false };
  if (!Device.isDevice) return { granted: false, canAskAgain: false };
  try {
    const Notifications = getNotifications();
    if (!Notifications) return { granted: false, canAskAgain: false };
    const { granted, canAskAgain } = await Notifications.getPermissionsAsync();
    return { granted, canAskAgain };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

/**
 * Calls back with the SOS payload when a notification is tapped, including the
 * one that cold-started the app. Returns an unsubscribe function.
 */
export function onNotificationOpened(handler) {
  const Notifications = getNotifications();
  if (!Notifications) return () => {};

  const extract = (response) => {
    const data = response?.notification?.request?.content?.data;
    if (data?.type === 'sos_alert' && data.sosId) handler(data);
  };

  Notifications.getLastNotificationResponseAsync().then(extract).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(extract);
  return () => sub.remove();
}
