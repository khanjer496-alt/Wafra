/**
 * Native wakes load the bundle without rendering a route, so index.js imports
 * this before Router: Android can process a bank alert after the app process
 * was killed, and iOS can run the wake-only relay handler.
 */
import '@/lib/android-live-background';
import '@/lib/background-relay';
