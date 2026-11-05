import { after } from 'next/server';

/** Runs `fn` after the response is sent. The only place that imports `after`, so tests can mock it. */
export function runInBackground(fn: () => Promise<void>): void {
  after(fn);
}
