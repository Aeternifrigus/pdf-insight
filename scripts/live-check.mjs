// Pomiar wdrożonego demo z perspektywy osoby z zewnątrz i zrzuty ekranu do README.
//
// Każdy przebieg to nowa, pusta przeglądarka (bez pamięci podręcznej i bez historii analiz),
// czyli dokładnie sytuacja recenzenta otwierającego link po raz pierwszy. Mierzone są:
// wczytanie strony oraz czas od wgrania pliku do pokazania podsumowania (Definition of Done:
// „w mniej niż 30 sekund widzi podsumowanie”). Drugi przebieg symuluje wolny internet
// mobilny (1,6 Mb/s, 150 ms) i 4× wolniejszy procesor, jak w profilu „mobile” Lighthouse.
//
//   npx playwright install chromium     # raz, pobiera przeglądarkę
//   npm run live:check -- ~/Downloads/Test_PDF_Insight_umowa_14-2026.pdf
//
// Wyniki: eval/results/live-timing.md, eval/results/live-contract.json (do `npm run check:facts`)
// oraz docs/screenshot.png i docs/screenshot-en.png (wynik po polsku i po angielsku).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pdf = process.argv[2];
const url = process.env.DEMO_URL ?? 'https://aeternifrigus.github.io/pdf-insight/';
if (!pdf) {
  console.error('Podaj ścieżkę do pliku PDF: npm run live:check -- /ścieżka/plik.pdf');
  process.exit(1);
}

const profiles = [
  { name: 'Zwykłe łącze (komputer)', slow: false },
  { name: 'Wolny internet mobilny (1,6 Mb/s, 150 ms, CPU ×4)', slow: true },
];

const resultsDir = join(root, 'eval', 'results');
mkdirSync(resultsDir, { recursive: true });
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const rows = [];
let screenshotsTaken = false;

for (const [i, profile] of profiles.entries()) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'pl-PL',
  });
  const page = await context.newPage();
  if (profile.slow) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const row = { profile: profile.name, load: 0, toResult: 0, model: '', note: '' };
  try {
    let t = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    row.load = Date.now() - t;
    t = Date.now();
    await page.locator('input[type=file]').setInputFiles(pdf);
    const summary = page.getByRole('heading', { name: 'Podsumowanie' });
    const failure = page.getByRole('alert');
    await Promise.race([
      summary.waitFor({ timeout: 120_000 }),
      failure.waitFor({ timeout: 120_000 }),
    ]);
    row.toResult = Date.now() - t;
    if (!(await summary.isVisible())) {
      row.note = `błąd: ${(await failure.innerText()).replace(/\s+/g, ' ').slice(0, 160)}`;
    } else {
      const insight = JSON.parse(await page.locator('pre.json-code').innerText());
      row.model = insight.analysis.model + (insight.analysis.backup ? ' (zapasowy)' : '');
      row.note = `OCR skanów: ${(insight.analysis.ocrVerifiedPages ?? []).join(', ') || 'nie zdążył'}`;
      if (i === 0) {
        writeFileSync(join(resultsDir, 'live-contract.json'), JSON.stringify(insight, null, 2));
        await page
          .screenshot({
            path: join(root, 'docs', 'screenshot.png'),
            fullPage: false,
            clip: { x: 0, y: 0, width: 1280, height: 1440 },
          })
          .catch(() => page.screenshot({ path: join(root, 'docs', 'screenshot.png') }));
        // Ten sam wynik po angielsku: interfejs i tłumaczenie wyniku.
        await page
          .getByRole('group', { name: 'Język interfejsu' })
          .getByRole('button', { name: 'English' })
          .click();
        await page
          .getByRole('group', { name: 'Result language' })
          .getByRole('button', { name: 'English' })
          .click();
        await page.getByText(/Machine translation from/).waitFor({ timeout: 90_000 });
        await page
          .screenshot({
            path: join(root, 'docs', 'screenshot-en.png'),
            clip: { x: 0, y: 0, width: 1280, height: 1500 },
          })
          .catch(() => page.screenshot({ path: join(root, 'docs', 'screenshot-en.png') }));
        screenshotsTaken = true;
      }
    }
  } catch (e) {
    row.note = `przerwane: ${String(e.message ?? e).slice(0, 160)}`;
  }
  rows.push(row);
  console.log(
    `${row.profile}: strona ${(row.load / 1000).toFixed(1)} s, wynik ${(row.toResult / 1000).toFixed(1)} s, ${row.model} ${row.note}`,
  );
  await context.close();
}
await browser.close();

const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
const report = [
  '# Pomiar demo z perspektywy osoby z zewnątrz',
  '',
  `Adres: ${url}. Data: ${new Date().toISOString()}. Plik: ${pdf.split('/').pop()}. Każdy przebieg w nowej przeglądarce, bez pamięci podręcznej i historii.`,
  '',
  '| Warunki | Wczytanie strony | Od wgrania pliku do podsumowania | Limit 30 s | Model | Uwagi |',
  '| --- | --: | --: | :-: | --- | --- |',
  ...rows.map(
    (r) =>
      `| ${r.profile} | ${s(r.load)} | ${s(r.toResult)} | ${r.model && r.toResult < 30_000 ? '✓' : '✗'} | ${r.model || '–'} | ${r.note} |`,
  ),
  '',
].join('\n');
writeFileSync(join(resultsDir, 'live-timing.md'), report);

// Podpis zrzutów w README: dopiero teraz są z prawdziwego demo, więc podpis to mówi.
if (screenshotsTaken) {
  const readmePath = join(root, 'README.md');
  const readme = readFileSync(readmePath, 'utf8')
    .replace(
      /^_Zrzuty .*_$/m,
      `_Zrzuty z wdrożonego demo (prawdziwy model), wykonane ${new Date().toISOString().slice(0, 10)} skryptem \`npm run live:check\`._`,
    )
    .replace(/^<!-- Przed oddaniem:.*-->\n\n?/m, '');
  writeFileSync(readmePath, readme);
}
console.log(`\n${report}`);
