const cursorUserAgent = "aur-cursor-bin-updater/1.0";

export type CursorFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export const defaultCursorFetch: CursorFetch = (input, init) =>
  fetch(input, init);

export function requestCursor(
  fetcher: CursorFetch,
  input: string,
  options: {
    method?: "HEAD";
    timeoutMs: number;
  },
) {
  return fetcher(input, {
    method: options.method,
    headers: { "User-Agent": cursorUserAgent },
    signal: AbortSignal.timeout(options.timeoutMs),
  });
}
