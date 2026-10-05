// Kopiuje zasoby pdf.js (dekodery WASM, CMapy, fonty standardowe, profile ICC) do public/pdfjs,
// skąd Vite publikuje je razem z aplikacją pod właściwą ścieżką `base`.
// Uruchamiane automatycznie przed `dev` i `build`; katalog docelowy jest w .gitignore.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'pdfjs-dist');
const target = join(root, 'public', 'pdfjs');

rmSync(target, { recursive: true, force: true });
for (const dir of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) {
  const from = join(source, dir);
  if (!existsSync(from)) throw new Error(`Brak katalogu pdfjs-dist/${dir}`);
  cpSync(from, join(target, dir), { recursive: true });
}
