import { moneyMentions } from './grounding';
import { detectDecimalStyle, extractDates } from './localeNumbers';
import type { ModelOutput } from './schema';

type Lists = Pick<ModelOutput, 'amounts' | 'dates'>;

const MAX_CONTEXT = 100;

/** Fragment zdania, w którym padła wartość: dzielony po przecinku lub średniku ze spacją. */
function clauseWith(text: string, has: (clause: string) => boolean): string {
  const clause = text.split(/[;,]\s+/).find(has) ?? text;
  const trimmed = clause.trim().replace(/[.;,]+$/, '');
  return trimmed.length <= MAX_CONTEXT
    ? trimmed
    : `${trimmed.slice(0, MAX_CONTEXT).replace(/\s+\S*$/, '')}…`;
}

/**
 * Spójność podsumowania i danych: data lub kwota, którą model podał w podsumowaniu albo
 * w punktach, a pominął w listach `dates` / `amounts`, jest do nich dopisywana (kodem, nie
 * przez model), z fragmentem zdania jako opisem. Przykład z pomiaru na żywo: model napisał
 * „od 1 kwietnia 2027 r. wzrasta do 13 100,00 PLN”, ale daty 2027-04-01 nie dał na listę.
 * Dopisane wartości przechodzą potem te same kontrole co reszta (obecność w dokumencie).
 */
export function reconcileLists(
  core: Pick<ModelOutput, 'summary' | 'keyPoints' | 'document'>,
  lists: Lists,
): Lists {
  const texts = [core.summary, ...core.keyPoints];
  const style = detectDecimalStyle(texts.join('\n'), core.document.language);
  const dates = [...lists.dates];
  const amounts = [...lists.amounts];
  for (const text of texts) {
    for (const date of extractDates(text).dates) {
      if (dates.some((d) => d.date === date)) continue;
      const context = clauseWith(text, (c) => extractDates(c).dates.includes(date));
      dates.push({ date, context });
    }
    for (const m of moneyMentions(text, style)) {
      const known = amounts.some(
        (a) => Math.abs(a.value - m.value) < 0.005 && a.currency === m.currency,
      );
      if (known) continue;
      const context = clauseWith(text, (c) =>
        moneyMentions(c, style).some((x) => x.value === m.value && x.currency === m.currency),
      );
      amounts.push({ value: m.value, currency: m.currency, context });
    }
  }
  return { amounts, dates };
}
