import AsyncStorage from '@react-native-async-storage/async-storage';

/** Web is a QA surface; native resolution swaps in the encrypted SQLCipher inbox. */
export const backgroundRelayStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};
