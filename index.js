/**
 * The app's entry point, and it exists for exactly one reason.
 *
 * When iOS wakes a TERMINATED app to hand it a background push, or gives it a
 * BGTaskScheduler window, expo-task-manager loads the JS bundle and then looks
 * for a task registered under the name the OS asked for. If nothing has called
 * `TaskManager.defineTask` by that point, the wake is dropped — silently, with
 * no error, on a phone nobody is looking at. React has not rendered anything in
 * that launch and never will, so a task defined inside a component, a hook, or
 * a screen module the router only reaches while rendering does not exist yet.
 *
 * So the definitions are imported here, before the router, which is what the
 * SDK 55 notification docs mean by "define and register the task in the module
 * scope of a JS module which is required early by your app".
 *
 * `expo-router/entry` is imported unchanged and still owns the app root. This
 * file must never grow into a second place where the app is configured.
 */
import './src/lib/relay-wake';

import 'expo-router/entry';
