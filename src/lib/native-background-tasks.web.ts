/**
 * The web build has no background tasks. Importing them at the entry would
 * pull the capture pipeline into the first bundle the public site loads and
 * slow every web start; the app layout still loads them lazily.
 */
export {};
