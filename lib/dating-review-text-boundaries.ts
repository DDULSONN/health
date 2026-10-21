// Preserve source positions when removing separators for obfuscated-word review.
// Signals are for human review only; this helper never edits profile content.
export function compactReviewText(source: string) {
  let text = "", offset = 0;
  const positions: number[] = [];
  for (const char of source) {
    if (!/[\s\p{P}\p{S}]/u.test(char)) {
      text += char;
      for (let index = 0; index < char.length; index++) positions.push(offset + index);
    }
    offset += char.length;
  }
  return { text, positions };
}

// Short ambiguous words can be manufactured by joining the end of one ordinary
// word to the start of another: "웃음, 경제관념" or "공존? 나름".
// Keep isolated/spaced spellings ("음 경", "존 나") detectable.
export function joinsUnrelatedWords(source: string, positions: number[], start: number, length: number) {
  const from = positions[start], to = positions[start + length - 1];
  if (from == null || to == null) return false;
  return /[\s\p{P}\p{S}]/u.test(source.slice(from, to + 1))
    && /[\p{L}\p{N}]$/u.test(source.slice(0, from))
    && /^[\p{L}\p{N}]/u.test(source.slice(to + 1));
}
