import manifest from '../../assets/videos/ios-setup/recordings-manifest.json';

export interface IosSetupRecording {
  source: number;
  poster: number;
  durationSeconds: number;
  width: number;
  height: number;
  title: string;
  description: string;
  note: string;
  /** Written steps absent from the footage deliberately have no timestamp. */
  chapters: { stepIndex: number; startSeconds: number }[];
}

/** Only verified recordings belong here. Missing footage keeps written setup available. */
const metadata = (kind: 'capture' | 'history', language: 'en' | 'ar') => {
  const record = manifest.recordings.find(item => item.kind === kind && item.language === language);
  if (!record) throw new Error(`Missing verified ${kind} recording: ${language}`);
  return record;
};

export const iosSetupRecordings: Partial<Record<'capture' | 'history' | 'apple-pay',
  Partial<Record<'en' | 'ar', IosSetupRecording>>>> = {
  capture: {
    en: { ...metadata('capture', 'en'), source: require('../../assets/videos/ios-setup/capture-automation-en.mp4'),
      poster: require('../../assets/videos/ios-setup/capture-automation-en.jpg') },
    ar: { ...metadata('capture', 'ar'), source: require('../../assets/videos/ios-setup/capture-automation-ar.mp4'),
      poster: require('../../assets/videos/ios-setup/capture-automation-ar.jpg') },
  },
  history: {
    en: { ...metadata('history', 'en'), source: require('../../assets/videos/ios-setup/history-install-start-en.mp4'),
      poster: require('../../assets/videos/ios-setup/history-install-start-en.jpg') },
    ar: { ...metadata('history', 'ar'), source: require('../../assets/videos/ios-setup/history-install-start-ar.mp4'),
      poster: require('../../assets/videos/ios-setup/history-install-start-ar.jpg') },
  },
};
