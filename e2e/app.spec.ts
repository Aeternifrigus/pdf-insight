import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { sampleInsight } from '../src/lib/fixtures';
import { analyzeRequestSchema, insightSchema, type AnalyzeRequest } from '../src/lib/schema';

const API = 'https://api.e2e.test/analyze';
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

/** Mock backendu: zapisuje żądania (zwalidowane schematem) i odpowiada przykładowym wynikiem. */
async function mockApi(page: Page, respond?: (route: Route) => Promise<void>) {
  const requests: AnalyzeRequest[] = [];
  await page.route(API, async (route) => {
    const body: unknown = route.request().postDataJSON();
    requests.push(analyzeRequestSchema.parse(body));
    if (respond) {
      await respond(route);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(sampleInsight()),
    });
  });
  return requests;
}

async function upload(page: Page, name: string) {
  await page.locator('input[type=file]').setInputFiles(fixture(name));
}

test('stan pusty informuje, że treść trafia do zewnętrznego API AI', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Przeciągnij tutaj plik PDF')).toBeVisible();
  await expect(page.getByText(/zewnętrznym API AI/)).toBeVisible();
});

test('PDF z tekstem: wysyła tekst, pokazuje wynik i pozwala pobrać poprawny JSON', async ({
  page,
}) => {
  const requests = await mockApi(page);
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();

  expect(requests).toHaveLength(1);
  expect(requests[0]?.images).toHaveLength(0);
  expect(requests[0]?.pages[0]?.text).toContain('Razem do zapłaty: 12 345,67 zł');
  // Nazwa pliku jest w żądaniu (do wyniku), ale backend nie przekazuje jej modelowi.
  expect(requests[0]?.fileName).toBe('text-with-injection.pdf');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Pobierz / }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('umowa.insight.json');
  const json: unknown = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(insightSchema.safeParse(json).success).toBe(true);
});

test('skan z dodanym nagłówkiem tekstowym jest wysyłany jako obraz', async ({ page }) => {
  const requests = await mockApi(page);
  await page.goto('./');
  await upload(page, 'scan-with-header.pdf');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  expect(requests[0]?.images.map((i) => i.page)).toEqual([1]);
});

test('skan w JPEG 2000 jest dekodowany (nie biała strona)', async ({ page }) => {
  const requests = await mockApi(page);
  await page.goto('./');
  await upload(page, 'scan-jpeg2000.pdf');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  const image = requests[0]?.images[0];
  expect(image?.page).toBe(1);
  // Pusty render tej strony ma ok. 17 tys. znaków base64, z treścią ponad 40 tys.
  expect(image?.data.length ?? 0).toBeGreaterThan(40_000);
});

test('wartości z wypełnionego formularza trafiają do analizy', async ({ page }) => {
  const requests = await mockApi(page);
  await page.goto('./');
  await upload(page, 'filled-form.pdf');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  const text = requests[0]?.pages[0]?.text ?? '';
  expect(text).toContain('4 250,00 PLN');
  expect(text).toContain('15.09.2026');
});

for (const [file, message] of [
  ['blank.pdf', 'W pliku nie ma tekstu do analizy.'],
  ['password.pdf', 'Plik jest zabezpieczony hasłem.'],
  ['not-a-pdf.pdf', 'jego zawartość nie jest PDF-em'],
] as const) {
  test(`${file}: czytelny błąd bez wysyłania do API`, async ({ page }) => {
    const requests = await mockApi(page);
    await page.goto('./');
    await upload(page, file);
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('button', { name: 'Spróbuj ponownie' })).toHaveCount(0);
    expect(requests).toHaveLength(0);
  });
}

test('błąd API pokazuje komunikat i pozwala ponowić z sukcesem', async ({ page }) => {
  let calls = 0;
  await mockApi(page, async (route) => {
    calls++;
    if (calls === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: { code: 'AI_UNAVAILABLE', message: 'Usługa AI jest chwilowo niedostępna.' },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(sampleInsight()),
    });
  });
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  await expect(page.getByRole('alert')).toContainText('Usługa AI jest chwilowo niedostępna.');
  await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  expect(calls).toBe(2);
});

test('odpowiedź niezgodna ze schematem nie jest wyświetlana', async ({ page }) => {
  await mockApi(page, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ...sampleInsight(), summary: 'Za krótko.' }),
    }),
  );
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  await expect(page.getByRole('alert')).toContainText('nie jest zgodny ze schematem');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toHaveCount(0);
});

test('ten sam plik drugi raz: wynik z historii, bez nowego zapytania', async ({ page }) => {
  const requests = await mockApi(page);
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  await page.getByRole('button', { name: 'Przeanalizuj kolejny plik' }).click();
  await upload(page, 'text-with-injection.pdf');
  await expect(page.getByText('Ten plik był już analizowany.')).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Przeanalizuj ten plik ponownie' }).click();
  await expect(page.getByText('Ten plik był już analizowany.')).toHaveCount(0);
  await expect.poll(() => requests.length).toBe(2);
});

test('układ działa od 360 px bez poziomego przewijania', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Content-Security-Policy nie blokuje aplikacji', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await mockApi(page);
  await page.goto('./');
  await upload(page, 'scan-jpeg2000.pdf');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('w polskim interfejsie nie ma angielskich etykiet poza przełącznikiem języka', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  const resultSwitch = page.getByRole('group', { name: 'Język wyniku' });
  await expect(resultSwitch).toContainText('Angielski');
  await expect(resultSwitch).not.toContainText('English');
});

test('kontrole w przeglądarce: ostrzeżenie o poleceniu dla AI i oznaczenie wartości spoza dokumentu', async ({
  page,
}) => {
  // Mock zwraca wynik dla innego dokumentu (umowa), więc kwota 184 500 zł nie występuje
  // w tekście wgranej faktury i musi zostać oznaczona; plik zawiera ukryte polecenie.
  await mockApi(page);
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  const warnings = page.getByRole('complementary', { name: 'Na co uważać' });
  await expect(warnings).toContainText('Strona 1: dokument zawiera tekst wyglądający na polecenie');
  await expect(warnings).toContainText('Tych wartości nie znaleziono w tekście dokumentu');
  await expect(page.locator('table.amounts')).toContainText('nie znaleziono w tekście');
});
