import { buildEvidence, checkAmount, checkDate, moneyMentions, type Evidence } from './grounding';
import { detectInjection, injectionWarnings } from './injection';
import { extractDates } from './localeNumbers';
import { dedupeStrings } from './merge';
import { insightSchema, type AnalyzeRequest, type Insight } from './schema';

/**
 * Kontrole deterministyczne wyniku, uruchamiane w przeglądarce po odpowiedzi backendu:
 * - heurystyka poleceń dla AI ukrytych w treści PDF (ostrzeżenie dla użytkownika),
 * - sprawdzenie kwot i dat z wyniku (listy, podsumowanie, punkty) w tekście dokumentu.
 * Działają tutaj, a nie w Workerze, bo przeglądarka ma już tekst dokumentu, a darmowy plan
 * Cloudflare daje ok. 10 ms CPU na żądanie (te kontrole zajmowały kilkadziesiąt ms).
 * Nie są zabezpieczeniem przed użytkownikiem (to jego przeglądarka), tylko informacją dla niego.
 */

/**
 * Ostrzeżenia heurystyczne mają pierwszeństwo; ostrzeżenie modelu o tym samym
 * (polecenie dla AI) jest wtedy pomijane, żeby nie dublować komunikatu.
 */
export function combineWarnings(heuristic: string[], fromModel: string[]): string[] {
  const aboutInjection = /\bAI\b|instrukc|polece|prompt/i;
  const model = heuristic.length > 0 ? fromModel.filter((w) => !aboutInjection.test(w)) : fromModel;
  return dedupeStrings([...heuristic, ...model]);
}

const fmt = (value: number, currency: string) => `${String(value)} ${currency}`;

function listWarning(prefix: string, items: string[]): string[] {
  if (items.length === 0) return [];
  const shown = items.slice(0, 10).join(', ');
  const more = items.length > 10 ? ` i ${String(items.length - 10)} innych` : '';
  return [`${prefix}: ${shown}${more}.`];
}

/**
 * Sprawdza kwoty i daty z wyniku w tekście dokumentu (bez AI). Niczego nie usuwa: oznacza
 * pozycje (`foundInText`, `issue`) i dodaje ostrzeżenia, decyzję zostawia użytkownikowi.
 * - Wartość obecna w dokumencie tylko w podejrzanym poleceniu (np. "1 PLN" z ukrytej instrukcji)
 *   jest oznaczana zawsze. Wcześniej taka wartość była „znaleziona w tekście”, bo tekst polecenia
 *   też jest tekstem dokumentu, więc kontrola potwierdzała właśnie skutek ataku.
 * - Wartość, która w dokumencie występuje tylko z inną walutą (8 600 EUR podane jako PLN), też.
 * - Wartość nieznaleziona w tekście przy obecnych skanach mogła pochodzić z obrazu:
 *   foundInText = null (nie da się sprawdzić) zamiast false.
 */
export function groundLists(
  req: Pick<AnalyzeRequest, 'pages' | 'images'>,
  amounts: Insight['amounts'],
  dates: Insight['dates'],
  languageHint?: string | null,
  evidence: Evidence = buildEvidence(req.pages, languageHint),
): { amounts: Insight['amounts']; dates: Insight['dates']; warnings: string[] } {
  const scans = req.images.length > 0;
  // Pola z kontroli są ustawiane od nowa (model nie może ich podać sam).
  const withoutCheck = <T extends { foundInText?: unknown; issue?: unknown }>(item: T) => {
    const copy = { ...item };
    delete copy.foundInText;
    delete copy.issue;
    return copy;
  };
  const checkedAmounts: Insight['amounts'] = amounts.map((a) => {
    const rest = withoutCheck(a);
    const result = checkAmount(a.value, a.currency, evidence);
    if (result === 'ok') return { ...rest, foundInText: true };
    if (result === 'notInText' && scans) return { ...rest, foundInText: null };
    return { ...rest, foundInText: false, issue: result };
  });
  const checkedDates: Insight['dates'] = dates.map((d) => {
    const rest = withoutCheck(d);
    const result = checkDate(d.date, evidence);
    if (result === 'ok') return { ...rest, foundInText: true };
    if (result === 'notInText' && scans) return { ...rest, foundInText: null };
    return { ...rest, foundInText: false, issue: result };
  });

  const injected = [
    ...checkedAmounts
      .filter((a) => a.issue === 'fromInstruction')
      .map((a) => fmt(a.value, a.currency)),
    ...checkedDates.filter((d) => d.issue === 'fromInstruction').map((d) => d.date),
  ];
  const mismatched = checkedAmounts
    .filter((a) => a.issue === 'currencyMismatch')
    .map((a) => {
      const inDoc = [...(evidence.money.get(Math.round(Math.abs(a.value) * 100) / 100) ?? [])];
      return `${fmt(a.value, a.currency)} (w dokumencie: ${inDoc.join('/')})`;
    });
  const missing = [
    ...checkedAmounts.filter((a) => a.issue === 'notInText').map((a) => fmt(a.value, a.currency)),
    ...checkedDates.filter((d) => d.issue === 'notInText').map((d) => d.date),
  ];
  return {
    amounts: checkedAmounts,
    dates: checkedDates,
    warnings: [
      ...listWarning(
        'Wynik zawiera wartości, które w dokumencie występują tylko w podejrzanym poleceniu dla AI (możliwa manipulacja wynikiem)',
        injected,
      ),
      ...listWarning('Waluta niezgodna z dokumentem', mismatched),
      ...listWarning(
        'Tych wartości nie znaleziono w tekście dokumentu, sprawdź je ręcznie',
        missing,
      ),
    ],
  };
}

/**
 * To samo sprawdzenie dla kwot i dat zapisanych w podsumowaniu i najważniejszych punktach.
 * Brief wymaga podsumowania „bez zmyślonych informacji”, a schemat sprawdza tylko jego format.
 * Sprawdzane są tylko kwoty z walutą i pełne daty (nie każda liczba), żeby nie zgłaszać
 * fałszywych alarmów dla liczb takich jak „5 etapów” czy „24 miesiące”.
 */
export function groundTexts(texts: string[], evidence: Evidence, scans: boolean): string[] {
  const joined = texts.join('\n');
  const injected = new Set<string>();
  const mismatched = new Set<string>();
  const missing = new Set<string>();
  for (const m of moneyMentions(joined, evidence.style)) {
    const result = checkAmount(m.value, m.currency, evidence);
    if (result === 'fromInstruction') injected.add(fmt(m.value, m.currency));
    else if (result === 'currencyMismatch') mismatched.add(fmt(m.value, m.currency));
    else if (result === 'notInText' && !scans) missing.add(fmt(m.value, m.currency));
  }
  for (const date of extractDates(joined).dates) {
    const result = checkDate(date, evidence);
    if (result === 'fromInstruction') injected.add(date);
    else if (result === 'notInText' && !scans) missing.add(date);
  }
  return [
    ...listWarning(
      'Podsumowanie lub najważniejsze punkty zawierają wartości, które w dokumencie występują tylko w podejrzanym poleceniu dla AI (możliwa manipulacja wynikiem, porównaj z dokumentem)',
      [...injected],
    ),
    ...listWarning('Waluta w podsumowaniu niezgodna z dokumentem', [...mismatched]),
    ...listWarning(
      'Podsumowanie lub najważniejsze punkty zawierają wartości, których nie znaleziono w tekście dokumentu',
      [...missing],
    ),
  ];
}

/** Uzupełnia wynik z backendu o wyniki kontroli. Wywoływane raz, zaraz po analizie. */
export function verifyInsight(
  insight: Insight,
  source: Pick<AnalyzeRequest, 'pages' | 'images'>,
): Insight {
  const heuristic = injectionWarnings(detectInjection(source.pages));
  const evidence = buildEvidence(source.pages, insight.document.language);
  const scans = source.images.length > 0;
  const grounded = groundLists(
    source,
    insight.amounts,
    insight.dates,
    insight.document.language,
    evidence,
  );
  const textWarnings = groundTexts([insight.summary, ...insight.keyPoints], evidence, scans);
  return insightSchema.parse({
    ...insight,
    amounts: grounded.amounts,
    dates: grounded.dates,
    analysis: {
      ...insight.analysis,
      warnings: dedupeStrings([
        ...combineWarnings(heuristic, insight.analysis.warnings),
        ...textWarnings,
        ...grounded.warnings,
      ]),
    },
  });
}
