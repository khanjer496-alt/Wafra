export const fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => globalThis.fetch(input, init);
