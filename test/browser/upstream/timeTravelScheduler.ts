/** Owner tests run in an isolated real Chromium page; real timers preserve the observable contract here. */
export async function runWithFakedTimers<T>(_options: { readonly useFakeTimers: boolean }, body: () => Promise<T>): Promise<T> {
  return body();
}
