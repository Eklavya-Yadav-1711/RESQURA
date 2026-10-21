import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import * as FileSystem from 'expo-file-system';

const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 30;
const IMAGE_OPTIONS = { mediaTypes: ['images'], quality: 0.35, base64: true, allowsEditing: false };

function chooseSource() {
  return new Promise((resolve) => {
    Alert.alert('Add media', 'Show responders what they are coming to', [
      { text: 'Take photo', onPress: () => resolve({ source: 'camera', kind: 'image' }) },
      { text: 'Choose photo', onPress: () => resolve({ source: 'library', kind: 'image' }) },
      { text: 'Record video', onPress: () => resolve({ source: 'camera', kind: 'video' }) },
      { text: 'Choose video', onPress: () => resolve({ source: 'library', kind: 'video' }) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

export async function pickImage(source) {
  const choice = source ? { source, kind: 'image' } : await chooseSource();
  if (choice?.kind === 'video') return pickVideo(choice);
  const from = choice?.source;
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
    ? await ImagePicker.launchCameraAsync(IMAGE_OPTIONS)
    : await ImagePicker.launchImageLibraryAsync({ ...IMAGE_OPTIONS, allowsMultipleSelection: false });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  if (!asset.base64) throw new Error('That image could not be read. Try another one.');

  const mimeType = asset.mimeType || guessMime(asset.uri);
  return {
    uri: asset.uri,
    dataUri: `data:${mimeType};base64,${asset.base64}`,
    mimeType,
    fileName: asset.fileName || `sos.${mimeType.split('/')[1] || 'jpg'}`,
    mediaType: 'image',
  };
}

export async function pickVideo(choice) {
  const from = choice?.source;
  if (!from) return null;
  const permission = from === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      from === 'camera'
        ? 'Camera access is off. Turn it on in Settings to record a video.'
        : 'Video access is off. Turn it on in Settings to attach a video.'
    );
  }
  const options = {
    mediaTypes: ['videos'],
    videoMaxDuration: MAX_VIDEO_SECONDS,
    allowsEditing: false,
  };
  const result = from === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if (asset.duration != null && asset.duration > MAX_VIDEO_SECONDS * 1000) {
    throw new Error(`Choose a video that is ${MAX_VIDEO_SECONDS} seconds or shorter.`);
  }
  const fileSize = Number(asset.fileSize);
  if (Number.isFinite(fileSize) && fileSize > MAX_VIDEO_BYTES) {
    throw new Error('That video is larger than 20 MB. Choose a shorter video.');
  }
  const mimeType = asset.mimeType || guessVideoMime(asset.uri);
  if (!['video/mp4', 'video/quicktime', 'video/3gpp'].includes(mimeType)) {
    throw new Error('Use an MP4 or MOV video.');
  }
  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const encodedBytes = Math.ceil(base64.length * 3 / 4);
  if (encodedBytes > MAX_VIDEO_BYTES) {
    throw new Error('That video is larger than 20 MB. Choose a shorter video.');
  }
  return {
    uri: asset.uri,
    dataUri: `data:${mimeType};base64,${base64}`,
    mimeType,
    fileName: asset.fileName || `sos.${mimeType === 'video/quicktime' ? 'mov' : 'mp4'}`,
    mediaType: 'video',
  };
}

function guessMime(uri = '') {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}

function guessVideoMime(uri = '') {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.3gp')) return 'video/3gpp';
  return 'video/mp4';
}
