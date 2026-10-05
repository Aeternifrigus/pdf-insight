export interface PageText {
  page: number;
  text: string;
}

export interface Chunk {
  pages: number[];
  text: string;
}

/**
 * Dzieli tekst dokumentu na fragmenty o długości maks. `maxChars`,
 * zachowując granice stron. Strona dłuższa niż limit jest cięta po akapitach,
 * a w ostateczności twardo.
 */
export function chunkPages(pages: PageText[], maxChars: number): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk = { pages: [], text: '' };

  const flush = () => {
    if (current.text.trim().length > 0 || current.pages.length > 0) chunks.push(current);
    current = { pages: [], text: '' };
  };

  for (const { page, text } of pages) {
    const block = `[Strona ${page}]\n${text.trim()}\n`;
    if (block.length > maxChars) {
      flush();
      for (const piece of splitLong(block, maxChars)) {
        chunks.push({ pages: [page], text: piece });
      }
      continue;
    }
    if (current.text.length + block.length > maxChars) flush();
    current.pages.push(page);
    current.text += (current.text ? '\n' : '') + block;
  }
  flush();
  return chunks.filter((c) => c.pages.length > 0);
}

function splitLong(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let buf = '';
  for (const para of text.split(/\n{2,}|\n/)) {
    if (para.length > maxChars) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      for (let i = 0; i < para.length; i += maxChars) out.push(para.slice(i, i + maxChars));
      continue;
    }
    if (buf.length + para.length + 1 > maxChars) {
      out.push(buf);
      buf = '';
    }
    buf += (buf ? '\n' : '') + para;
  }
  if (buf) out.push(buf);
  return out;
}
