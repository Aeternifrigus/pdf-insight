import type { Amount, DateEntry, ModelOutput } from './schema';

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl');

export function dedupeStrings(values: string[], limit = Infinity): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim().replace(/\s+/g, ' ');
    const key = norm(t);
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

export function dedupeAmounts(amounts: Amount[]): Amount[] {
  const seen = new Set<string>();
  return amounts.filter((a) => {
    const key = `${a.value}|${a.currency}|${norm(a.context)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dedupeDates(dates: DateEntry[]): DateEntry[] {
  const seen = new Set<string>();
  return dates
    .filter((d) => {
      const key = `${d.date}|${norm(d.context)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Deterministyczne łączenie list z wyników cząstkowych (etap "map"). */
export function mergeLists(parts: ModelOutput[]) {
  return {
    entities: {
      organizations: dedupeStrings(parts.flatMap((p) => p.entities.organizations)),
      people: dedupeStrings(parts.flatMap((p) => p.entities.people)),
    },
    amounts: dedupeAmounts(parts.flatMap((p) => p.amounts)),
    dates: dedupeDates(parts.flatMap((p) => p.dates)),
    keywords: dedupeStrings(
      parts.flatMap((p) => p.keywords),
      15,
    ),
    warnings: dedupeStrings(parts.flatMap((p) => p.warnings)),
  };
}
