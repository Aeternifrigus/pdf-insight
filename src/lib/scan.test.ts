import { describe, expect, it } from 'vitest';
import { isBlankImage, isScanCandidate, renderScale, selectScanPages } from './scan';

describe('isScanCandidate', () => {
  it('traktuje stronę bez tekstu jako skan', () => {
    expect(isScanCandidate({ page: 1, textChars: 0, hasImages: false })).toBe(true);
  });

  it('wykrywa skan z dodanym nagłówkiem tekstowym', () => {
    expect(isScanCandidate({ page: 1, textChars: 70, hasImages: true })).toBe(true);
  });

  it('nie renderuje zwykłej strony tekstowej ani krótkiej strony bez obrazów', () => {
    expect(isScanCandidate({ page: 1, textChars: 1600, hasImages: true })).toBe(false);
    expect(isScanCandidate({ page: 1, textChars: 120, hasImages: false })).toBe(false);
  });
});

describe('selectScanPages', () => {
  it('przy limicie wybiera strony z najmniejszą ilością tekstu', () => {
    const pages = [
      { page: 1, textChars: 300, hasImages: true }, // okładka z logo
      { page: 2, textChars: 0, hasImages: true },
      { page: 3, textChars: 2000, hasImages: false },
      { page: 4, textChars: 0, hasImages: true },
      { page: 5, textChars: 60, hasImages: true },
    ];
    expect(selectScanPages(pages, 2)).toEqual({ selected: [2, 4], skipped: [1, 5] });
  });
});

describe('renderScale', () => {
  it('ogranicza liczbę pikseli dla bardzo długich stron', () => {
    const s = renderScale(200, 14000);
    expect(200 * s * 14000 * s).toBeLessThanOrEqual(4_000_001);
  });

  it('dla A4 renderuje w skali 2× (ok. 1190 px szerokości)', () => {
    expect(Math.round(595 * renderScale(595, 842))).toBe(1190);
  });
});

describe('isBlankImage', () => {
  const page = (w: number, h: number, fill: number) => new Uint8ClampedArray(w * h * 4).fill(fill);

  it('uznaje jednolitą stronę za pustą', () => {
    expect(isBlankImage(page(256, 256, 255))).toBe(true);
    expect(isBlankImage(page(256, 256, 128))).toBe(true);
  });

  it('nie uznaje za pustą strony z jedną krótką linijką tekstu', () => {
    const img = page(256, 256, 250);
    for (let x = 40; x < 90; x++) {
      for (let y = 30; y < 33; y++) img.fill(30, (y * 256 + x) * 4, (y * 256 + x) * 4 + 3);
    }
    expect(isBlankImage(img)).toBe(false);
  });
});
