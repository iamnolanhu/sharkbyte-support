import { describe, expect, it } from 'vitest';
import { createDashFilter } from './dash-filter';

/** Streams `deltas` through one filter and returns everything it sent. */
function run(...deltas: string[]): string {
  const filter = createDashFilter();
  return deltas.map((d) => filter.push(d)).join('') + filter.flush();
}

describe('createDashFilter', () => {
  it('turns a dash between clauses into a comma, and before a new sentence into a period', () => {
    expect(run('We build agents — they answer the phone.')).toBe('We build agents, they answer the phone.');
    expect(run('Book on our contact page – it takes a minute.')).toBe('Book on our contact page, it takes a minute.');
    expect(run('We are remote — I can set up a video call.')).toBe('We are remote. I can set up a video call.');
    expect(run('Our site—just click Talk to us.')).toBe('Our site, just click Talk to us.');
  });

  it('ends a sentence with a period when the dash is last on the line or in the text', () => {
    expect(run('We answer every channel —\nchat and phone.')).toBe('We answer every channel.\nchat and phone.');
    expect(run('That is all we know —')).toBe('That is all we know.');
  });

  it('keeps number ranges and list bullets readable', () => {
    expect(run('Most projects run $30–60K.')).toBe('Most projects run $30-60K.');
    expect(run('Options:\n– chat\n– phone')).toBe('Options:\n- chat\n- phone');
    expect(run('– first')).toBe('- first');
  });

  it('does not double up punctuation', () => {
    expect(run('Yes, — we do.')).toBe('Yes, we do.');
  });

  it('handles a dash split across deltas', () => {
    expect(run('We build agents ', '—', ' they answer.')).toBe('We build agents, they answer.');
    expect(run('We build agents —', ' They answer.')).toBe('We build agents. They answer.');
    expect(run('Most run $30', '–', '60K.')).toBe('Most run $30-60K.');
    expect(run('Remote ', ' — ', '', 'sorry.')).toBe('Remote, sorry.');
  });

  it('holds back only an undecided tail and passes everything else through at once', () => {
    const filter = createDashFilter();
    expect(filter.push('Hello there')).toBe('Hello there');
    expect(filter.push(' friend —')).toBe(' friend');
    expect(filter.push(' welcome')).toBe(', welcome');
    expect(filter.flush()).toBe('');
  });

  it('leaves text without dashes alone, hyphens included', () => {
    expect(run('Reply in 2-4 short sentences, ', 'please.')).toBe('Reply in 2-4 short sentences, please.');
  });
});
