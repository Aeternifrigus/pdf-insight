import { expect, test } from '@playwright/test';
import { insightSchema } from '../src/lib/schema';
import { downloadOf, englishInsight, fulfillJson, mockApi, upload } from './helpers';

test('przełącznik zmienia interfejs na angielski i zapamiętuje wybór', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Przeciągnij tutaj plik PDF')).toBeVisible();
  await page
    .getByRole('group', { name: 'Język interfejsu' })
    .getByRole('button', { name: 'English' })
    .click();
  await expect(page.getByText('Drag a PDF file here')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.getByText('Drag a PDF file here')).toBeVisible();
});

test('wynik po angielsku: angielski zapis liczb, tłumaczenie z historii i pobrania', async ({
  page,
}) => {
  const calls = await mockApi(page);
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  const amounts = page.locator('table.amounts');
  // Oryginał: polski zapis (spacja tysięcy, przecinek dziesiętny).
  await expect(amounts).toContainText(/184\s500,00\szł/);

  await page
    .getByRole('group', { name: 'Język wyniku' })
    .getByRole('button', { name: 'English' })
    .click();
  // Tłumaczenie: angielski zapis (przecinek tysięcy, kropka dziesiętna), ta sama wartość.
  await expect(amounts).toContainText(/PLN\s184,500\.00/);
  await expect(page.locator('p.summary')).toContainText(
    'The implementation fee is PLN 184,500.00 net.',
  );
  await expect(
    page.getByText(/Liczby i daty w przetłumaczonych tekstach zgadzają się/),
  ).toBeVisible();
  expect(calls.translate).toHaveLength(1);
  expect(calls.translate[0]?.target).toBe('en');

  const json = await downloadOf(page, () =>
    page.getByRole('button', { name: /^Pobierz .*\.en\.json$/ }).click(),
  );
  expect(json.name).toBe('umowa.insight.en.json');
  const parsed = insightSchema.parse(JSON.parse(json.text));
  expect(parsed.analysis.translation?.to).toBe('en');
  expect(parsed.amounts[0]?.value).toBe(184500);

  const md = await downloadOf(page, () =>
    page.getByRole('button', { name: 'Podsumowanie .md (EN)' }).click(),
  );
  expect(md.name).toBe('umowa.summary.en.md');
  expect(md.text).toContain('## Summary');
  expect(md.text.replace(/\s/g, ' ')).toContain('| PLN 184,500.00 |');

  await page.getByRole('button', { name: /^Oryginał/ }).click();
  await expect(amounts).toContainText(/184\s500,00\szł/);
  const plMd = await downloadOf(page, () =>
    page.getByRole('button', { name: 'Podsumowanie .md (PL)' }).click(),
  );
  expect(plMd.name).toBe('umowa.summary.md');
  expect(plMd.text.replace(/\s/g, ' ')).toContain('| 184 500,00 zł |');

  // Po przeładowaniu tłumaczenie jest w historii: bez nowego zapytania do API.
  await page.reload();
  await page.getByRole('button', { name: /Umowa ramowa nr 14\/2026/ }).click();
  await page
    .getByRole('group', { name: 'Język wyniku' })
    .getByRole('button', { name: 'English' })
    .click();
  await expect(amounts).toContainText(/PLN\s184,500\.00/);
  expect(calls.translate).toHaveLength(1);
});

test('tłumaczenie z niezgodnymi liczbami jest jawnie oznaczone', async ({ page }) => {
  await mockApi(page, {
    translate: (route) =>
      fulfillJson(
        route,
        englishInsight({
          numbersVerified: false,
          issues: [{ field: 'summary', missing: ['184500'], extra: ['184000'], wrongFormat: [] }],
        }),
      ),
  });
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  await page
    .getByRole('group', { name: 'Język wyniku' })
    .getByRole('button', { name: 'English' })
    .click();
  await expect(page.getByText(/nie zgadzają się z oryginałem/)).toBeVisible();
  await expect(page.getByText('summary: brakuje 184500; dodatkowo 184000')).toBeVisible();
});

test('cały dokument po angielsku: fragmenty, pobranie .md z kontrolą liczb', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('./');
  await upload(page, 'text-with-injection.pdf');
  const file = await downloadOf(page, () =>
    page.getByRole('button', { name: /^Przetłumacz cały dokument/ }).click(),
  );
  expect(file.name).toBe('umowa.en.md');
  expect(file.text).toContain('## Page 1');
  expect(file.text).toContain('Invoice total: PLN 12,345.67');
  expect(file.text).toContain('Numbers and dates on all text pages match the original.');
  expect(calls.translateDocument[0]).toMatchObject({ target: 'en', sourceLanguage: 'pl' });
  expect(calls.translateDocument[0]?.pages[0]?.text).toContain('Razem do zapłaty: 12 345,67 zł');
});

test('komunikaty błędów są w języku interfejsu', async ({ page }) => {
  await mockApi(page, {
    analyze: (route) =>
      fulfillJson(
        route,
        { error: { code: 'AI_UNAVAILABLE', message: 'Usługa AI jest chwilowo niedostępna.' } },
        503,
      ),
  });
  await page.goto('./');
  await page
    .getByRole('group', { name: 'Język interfejsu' })
    .getByRole('button', { name: 'English' })
    .click();
  await upload(page, 'text-with-injection.pdf');
  await expect(page.getByRole('alert')).toContainText('The AI service is temporarily unavailable.');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
