/**
 * iOS entry for native-background-tasks.ts. A wake on iOS only runs the
 * wake-only relay handler (background-relay defines its task at module scope),
 * so this loads nothing else: the Android SMS/notification capture stack, which
 * registers nothing on iOS, stays out of the first bundle evaluation.
 */
import '@/lib/background-relay';
