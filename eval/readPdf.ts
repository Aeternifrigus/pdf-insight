import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { formFieldLines } from '../src/lib/forms';
import { joinTextItems, type TextItemLike } from '../src/lib/textItems';

/** Tekst stron PDF odczytany tą samą logiką co aplikacja (bez renderowania skanów). */
export async function readPdfPages(path: string): Promise<{ page: number; text: string }[]> {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  const pages: { page: number; text: string }[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = joinTextItems(
      content.items.filter((i): i is TextItemLike & typeof i => 'str' in i),
    );
    const fields = formFieldLines((await page.getAnnotations()) as unknown[]);
    pages.push({ page: n, text: fields.length ? `${text}\n${fields.join('\n')}` : text });
  }
  return pages;
}
