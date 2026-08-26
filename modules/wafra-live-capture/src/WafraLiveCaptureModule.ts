import { requireNativeModule } from 'expo';

import type { WafraLiveCaptureNativeModule } from './WafraLiveCapture.types';

export default requireNativeModule<WafraLiveCaptureNativeModule>('WafraLiveCapture');
