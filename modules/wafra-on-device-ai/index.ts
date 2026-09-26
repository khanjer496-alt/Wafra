import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Platform language models that run on the phone itself (tasks: `ask-plan`,
 * `categorize`, and `alert-read` — Review suggestions for a bank alert no
 * parser read, see src/lib/ai-alert-platform-reader.ts):
 * - iOS 26+: Apple Foundation Models (`SystemLanguageModel.default`).
 * - Android 8+ with AICore: Gemini Nano through the ML Kit GenAI Prompt API.
 *
 * The bridge carries only the instructions, the prompt and a closed output
 * schema that JavaScript builds. There is no network API here: Apple runs the
 * model on device, and AICore runs Gemini Nano on device. Returned text is
 * untrusted until `src/lib/on-device-ai.ts` has validated it.
 */
export type WafraOnDeviceAIStatus =
  | 'available'
  | 'unsupported-os'
  | 'device-not-eligible'
  | 'not-enabled'
  | 'model-not-ready'
  | 'unavailable';

export type WafraOnDeviceAIProvider = 'apple-foundation-models' | 'gemini-nano';

export interface WafraOnDeviceAINativeAvailability {
  status: WafraOnDeviceAIStatus;
  provider: WafraOnDeviceAIProvider | null;
  /**
   * BCP-47 language codes the platform model reports as supported, or null
   * when the platform does not publish a list (Gemini Nano).
   */
  languages: string[] | null;
  /** Android only: AICore reports the model as downloadable on request. */
  canPrepare: boolean;
}

export interface WafraOnDeviceAINativeModule {
  getAvailability(): Promise<WafraOnDeviceAINativeAvailability>;
  /**
   * `schemaJson` is a closed field list (see `OnDeviceClosedSchema`). Apple
   * applies it as guided generation; Gemini Nano receives it in the prompt and
   * JavaScript rejects anything outside it. Resolves to a JSON object string.
   */
  respond(
    requestId: string,
    task: string,
    instructions: string,
    prompt: string,
    schemaJson: string,
    maxTokens: number,
    timeoutMs: number,
  ): Promise<string>;
  cancel(requestId: string): Promise<void>;
  /** Android only: asks AICore to fetch Gemini Nano. Never called automatically. */
  prepare(): Promise<WafraOnDeviceAINativeAvailability>;
  /**
   * Low Power Mode (iOS ProcessInfo) / Battery Saver (Android PowerManager).
   * Optional: absent in native builds that predate it.
   */
  getPowerState?(): Promise<{ lowPowerMode: boolean }>;
  /**
   * The active connection for "Wi-Fi only" downloads: 'wifi' (Wi-Fi or
   * Ethernet), 'cellular', 'none' or 'unknown'. Reads OS state only; it makes
   * no request. Optional: absent in native builds that predate it.
   */
  getNetworkType?(): Promise<'wifi' | 'cellular' | 'none' | 'unknown'>;
}

export default requireOptionalNativeModule<WafraOnDeviceAINativeModule>('WafraOnDeviceAI');
