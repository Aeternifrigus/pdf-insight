/** [1, 2, 3, 5, 7, 8] → "1–3, 5, 7–8". Długie listy stron są czytelne w komunikatach i promptach. */
export function formatPageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = start;
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n !== undefined && prev !== undefined && n === prev + 1) {
      prev = n;
      continue;
    }
    if (start !== undefined && prev !== undefined) {
      parts.push(start === prev ? String(start) : `${String(start)}–${String(prev)}`);
    }
    start = n;
    prev = n;
  }
  return parts.join(', ');
}
