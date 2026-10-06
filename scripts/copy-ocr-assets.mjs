// Kopiuje zasoby OCR (worker tesseract.js, rdzeń WASM, model języka polskiego) do public/ocr.
// Wszystko jest serwowane z własnej domeny: domyślnie tesseract.js pobiera te pliki z CDN,
// czego Content-Security-Policy aplikacji nie pozwala. Katalog docelowy jest w .gitignore.
// Przeglądarka pobiera z nich tylko jeden wariant rdzenia (zależnie od obsługi SIMD) i tylko
// wtedy, gdy dokument ma zeskanowane strony.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');
const target = join(root, 'public', 'ocr');

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  [
    'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  // Wariant „best_int”: mniejszy (2,6 MB) i dokładniejszy na liczbach niż domyślny.
  ['@tesseract.js-data/pol/4.0.0_best_int/pol.traineddata.gz', 'pol.traineddata.gz'],
];

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const [from, to] of files) {
  const source = join(modules, from);
  if (!existsSync(source)) throw new Error(`Brak pliku OCR: ${from}`);
  copyFileSync(source, join(target, to));
}
