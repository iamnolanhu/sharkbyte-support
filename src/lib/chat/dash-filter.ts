/**
 * Rewrites em and en dashes in streamed model text, so Sammy's replies never carry the dash that
 * reads as machine-written even when the model ignores the voice guide. Text arrives in deltas, so
 * a dash (or the spaces around it) at the end of one delta is held until the next one shows what
 * follows it.
 */

const DASH = /([ \t]*)([—–])([ \t]*)/g;

/** Trailing spaces, optionally with a dash and more spaces: what follows them is not known yet. */
const UNDECIDED_TAIL = /[ \t]*(?:[—–][ \t]*)?$/;

/** What one dash (with the spaces around it) becomes, given the characters on each side. */
function replacement(lead: string, trail: string, before: string, after: string | undefined): string {
  // A number range written without spaces stays a range: 30–60 → 30-60.
  if (!lead && !trail && /\d/.test(before) && after !== undefined && /\d/.test(after)) return '-';
  // A dash that starts a line is a list bullet.
  if (before === '\n') return `${lead}- `;
  // After punctuation the dash only separated; keep a single space.
  if (/[,.;:!?]/.test(before)) return after === undefined || after === '\n' ? '' : ' ';
  // At the end of the text or a line, the dash ended a sentence.
  if (after === undefined || after === '\n') return '.';
  // Before a capital letter it started a new sentence; otherwise it joined two clauses.
  return /[A-Z]/.test(after) ? '. ' : ', ';
}

function rewrite(text: string, previous: string): string {
  return text.replace(DASH, (match: string, lead: string, _dash: string, trail: string, offset: number) => {
    const before = offset === 0 ? previous : text[offset - 1];
    return replacement(lead, trail, before, text[offset + match.length]);
  });
}

export interface DashFilter {
  /** The part of `delta` that can be sent now (it may hold back a trailing dash or spaces). */
  push(delta: string): string;
  /** Whatever is still held, rewritten as the end of the text. */
  flush(): string;
}

export function createDashFilter(): DashFilter {
  let pending = '';
  // The last character already sent; the start of the text counts as the start of a line.
  let previous = '\n';
  const emit = (text: string): string => {
    const out = rewrite(text, previous);
    if (text) previous = text[text.length - 1];
    return out;
  };
  return {
    push(delta) {
      pending += delta;
      const cut = pending.search(UNDECIDED_TAIL);
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      return emit(ready);
    },
    flush() {
      const rest = pending;
      pending = '';
      return emit(rest);
    },
  };
}
