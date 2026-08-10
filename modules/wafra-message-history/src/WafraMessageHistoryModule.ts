import { requireNativeModule } from 'expo';

import type { WafraHistoryNativeModule } from './WafraMessageHistory.types';

export default requireNativeModule<WafraHistoryNativeModule>('WafraMessageHistory');
