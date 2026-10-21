import { Alert, Platform, Share } from 'react-native';
import * as SMS from 'expo-sms';
import * as Clipboard from 'expo-clipboard';

// Getting the emergency out to people who are not on the app: your own
// contacts by SMS, or anyone at all through the phone's share sheet.

export function buildAlertText(name, message, shareUrl) {
  return [
    `${name || 'Someone'} needs help.`,
    message,
    shareUrl ? `Live location: ${shareUrl}` : null,
    'Sent from RESQORA',
  ].filter(Boolean).join('\n');
}

/**
 * Opens the phone's SMS composer with the message and your contacts prefilled.
 * The user still presses send, which is what keeps this free of any SMS
 * gateway and honest about who sent it.
 */
export async function textContacts(contacts, body) {
  const numbers = (contacts || []).map((c) => c.phone).filter(Boolean);
  if (!numbers.length) throw new Error('No emergency contacts saved yet.');

  const available = await SMS.isAvailableAsync();
  if (!available) throw new Error('This device cannot send SMS.');

  const { result } = await SMS.sendSMSAsync(numbers, body);
  return result;
}

/** The share sheet — WhatsApp, Telegram, anything installed. */
export async function shareLink(body) {
  return await Share.share(
    Platform.OS === 'ios' ? { message: body } : { message: body },
    { dialogTitle: 'Send my live location' }
  );
}

export async function copyLink(url) {
  await Clipboard.setStringAsync(url);
  Alert.alert('Link copied', 'Paste it anywhere to share your live location.');
}
