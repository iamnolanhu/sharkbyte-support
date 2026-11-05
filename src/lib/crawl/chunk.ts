export interface ChunkOptions {
  targetTokens: number;
  overlapTokens: number;
}

interface Piece {
  text: string;
  /** Separator placed before this piece when it joins an earlier one. */
  sep: string;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hardCut(text: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

function splitLongParagraph(paragraph: string, max: number): Piece[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];
  const pieces: Piece[] = [];
  let current = '';
  const flush = () => {
    const text = current.trim();
    if (text) pieces.push({ text, sep: pieces.length === 0 ? '\n\n' : ' ' });
    current = '';
  };
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > max) {
      flush();
      for (const part of hardCut(sentence, max)) {
        pieces.push({ text: part, sep: pieces.length === 0 ? '\n\n' : ' ' });
      }
      continue;
    }
    if (current && current.length + 1 + sentence.length > max) flush();
    current = current ? `${current} ${sentence}` : sentence;
  }
  flush();
  return pieces;
}

export function chunkText(text: string, opts: ChunkOptions): string[] {
  const max = Math.max(1, opts.targetTokens * 4);
  const overlapChars = Math.max(0, opts.overlapTokens * 4);

  const pieces: Piece[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (trimmed.length <= max) pieces.push({ text: trimmed, sep: '\n\n' });
    else pieces.push(...splitLongParagraph(trimmed, max));
  }

  const bodies: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (!current) {
      current = piece.text;
    } else if (current.length + piece.sep.length + piece.text.length <= max) {
      current += piece.sep + piece.text;
    } else {
      bodies.push(current);
      current = piece.text;
    }
  }
  if (current) bodies.push(current);

  return bodies.map((body, i) => {
    if (i === 0 || overlapChars === 0) return body;
    const prev = bodies[i - 1];
    return `${prev.slice(-overlapChars)}${body}`;
  });
}
