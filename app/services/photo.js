import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

// One photo picker for the whole app: ask camera or gallery, return the asset
// as a data URI the server can store. Resolves to null if the user backs out.

const OPTIONS = { mediaTypes: ['images'], quality: 0.35, base64: true, allowsEditing: false };

function chooseSource() {
  return new Promise((resolve) => {
    Alert.alert('Add a photo', 'Show responders what they are coming to', [
      { text: 'Take photo', onPress: () => resolve('camera') },
      { text: 'Choose from gallery', onPress: () => resolve('library') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

export async function pickImage(source) {
  const from = source || await chooseSource();
  if (!from) return null;

  const permission = from === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    throw new Error(
      from === 'camera'
        ? 'Camera access is off. Turn it on in Settings to photograph the scene.'
        : 'Photo access is off. Turn it on in Settings to attach an image.'
    );
  }

  const result = from === 'camera'
    ? await ImagePicker.launchCameraAsync(OPTIONS)
    : await ImagePicker.launchImageLibraryAsync({ ...OPTIONS, allowsMultipleSelection: false });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  if (!asset.base64) throw new Error('That image could not be read. Try another one.');

  const mimeType = asset.mimeType || guessMime(asset.uri);
  return {
    uri: asset.uri,
    dataUri: `data:${mimeType};base64,${asset.base64}`,
    mimeType,
    fileName: asset.fileName || `sos.${mimeType.split('/')[1] || 'jpg'}`,
  };
}

function guessMime(uri = '') {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}
