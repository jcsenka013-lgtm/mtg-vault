import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface VisionOcrResult {
  lines: string[];
}

const ExpoVisionOcrNative = Platform.OS === 'ios' ? requireNativeModule('ExpoVisionOcr') : null;

export function recognizeText(fileUri: string): Promise<VisionOcrResult> {
  if (!ExpoVisionOcrNative) {
    return Promise.reject(new Error('ExpoVisionOcr is only available on iOS.'));
  }
  return ExpoVisionOcrNative.recognizeText(fileUri);
}
