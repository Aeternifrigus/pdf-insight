import type { NumericIssue } from '../lib/schema';

export type Lang = 'pl' | 'en';
export const LANGS: Lang[] = ['pl', 'en'];

/**
 * Lokale formatowania. Brytyjski angielski: "12 March 2026" i "PLN 184,500.00"
 * (data bez dwuznaczności dzień/miesiąc, kropka dziesiętna i przecinek tysięcy).
 * Polski: "12 marca 2026" i "184 500,00 zł" (przecinek dziesiętny, spacja tysięcy).
 */
export const LOCALES: Record<Lang, string> = { pl: 'pl-PL', en: 'en-GB' };

const plPages = (n: number) => {
  if (n === 1) return '1 strona';
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${String(n)} strony`;
  return `${String(n)} stron`;
};

const plIssue = (i: NumericIssue) =>
  [
    i.missing.length ? `brakuje ${i.missing.join(', ')}` : '',
    i.extra.length ? `dodatkowo ${i.extra.join(', ')}` : '',
    i.wrongFormat.length ? `zły zapis ${i.wrongFormat.map((w) => `„${w}”`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');

const enIssue = (i: NumericIssue) =>
  [
    i.missing.length ? `missing ${i.missing.join(', ')}` : '',
    i.extra.length ? `added ${i.extra.join(', ')}` : '',
    i.wrongFormat.length ? `wrong notation ${i.wrongFormat.map((w) => `"${w}"`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');

export const pl = {
  appTagline: 'Wgraj PDF, a dostaniesz krótkie podsumowanie i dane gotowe do pobrania jako JSON.',
  interfaceLanguage: 'Język interfejsu',
  languageNames: { pl: 'Polski', en: 'English' } as Record<Lang, string>,
  configMissing:
    'Brak adresu backendu (VITE_API_URL). Analiza nie zadziała, dopóki nie zostanie skonfigurowany.',
  upload: {
    title: 'Przeciągnij tutaj plik PDF',
    dragging: 'Upuść plik, aby rozpocząć analizę',
    action: 'albo wybierz go z dysku',
    hint: 'PDF do 10 MB. Skany stron też zostaną odczytane. Treść pliku trafi do analizy w zewnętrznym API AI.',
  },
  emptyHint:
    'Nie masz jeszcze żadnych analiz. Dobrze sprawdzają się umowy, faktury, oferty i raporty.',
  progress: {
    steps: {
      upload: 'Wgranie pliku',
      reading: 'Odczyt tekstu',
      analyzing: 'Analiza AI',
      result: 'Wynik',
    },
    opening: 'Otwieranie pliku',
    page: (done: number, total: number) => `Strona ${String(done)} z ${String(total)}`,
    analyzing: 'Model czyta dokument i wypełnia schemat danych',
    cancel: 'Anuluj',
  },
  error: {
    title: 'Analiza się nie udała',
    details: 'Szczegóły techniczne',
    retry: 'Spróbuj ponownie',
    chooseOther: 'Wybierz inny plik',
  },
  errors: {
    NOT_PDF: 'To nie jest plik PDF. Wybierz plik z rozszerzeniem .pdf.',
    EMPTY: 'Plik jest pusty.',
    TOO_LARGE: (size: string) => `Plik ma ${size}. Maksymalny rozmiar to 10 MB.`,
    BAD_SIGNATURE: 'Plik ma rozszerzenie .pdf, ale jego zawartość nie jest PDF-em.',
    PASSWORD: 'Plik jest zabezpieczony hasłem. Usuń hasło i spróbuj ponownie.',
    CORRUPT: 'Nie udało się otworzyć pliku. Może być uszkodzony.',
    UNREADABLE:
      'Przeglądarka nie odczytała żadnej strony tego pliku. Spróbuj w aktualnej wersji Chrome, Edge, Firefox lub Safari.',
    TOO_MANY_PAGES: (n: number) => `Plik ma ${String(n)} stron. Limit to 2000 stron.`,
    TOO_MUCH_TEXT: (limit: string, page: number, total: number) =>
      `Dokument ma ponad ${limit} znaków tekstu (przekroczone na stronie ${String(page)} z ${String(total)}). Spróbuj krótszego pliku.`,
    NO_TEXT: 'W pliku nie ma tekstu do analizy.',
    UNEXPECTED: 'Wystąpił nieoczekiwany błąd. Spróbuj ponownie.',
    NO_API_URL: 'Brak adresu backendu (VITE_API_URL). Aplikacja jest źle skonfigurowana.',
    TIMEOUT: 'Analiza trwała zbyt długo. Spróbuj ponownie.',
    NETWORK: 'Brak połączenia z serwerem analizy. Sprawdź internet i spróbuj ponownie.',
    BAD_RESPONSE: (status: number) =>
      `Serwer zwrócił nieczytelną odpowiedź (HTTP ${String(status)}).`,
    SCHEMA: 'Wynik analizy nie jest zgodny ze schematem danych.',
    BAD_REQUEST: 'Nieprawidłowe dane żądania.',
    FORBIDDEN_ORIGIN: 'Ta domena nie ma dostępu do API.',
    PAYLOAD_TOO_LARGE: 'Dokument jest zbyt duży do analizy. Spróbuj krótszego pliku.',
    RATE_LIMITED: 'Za dużo zapytań w krótkim czasie. Odczekaj minutę i spróbuj ponownie.',
    AI_RATE_LIMITED: 'Przekroczono limit zapytań do dostawcy AI. Spróbuj ponownie za minutę.',
    AI_UNAVAILABLE: 'Usługa AI jest chwilowo niedostępna.',
    AI_TIMEOUT: 'Analiza trwała zbyt długo. Spróbuj krótszego pliku.',
    AI_REFUSED: 'Dostawca AI odmówił analizy tego dokumentu (filtr treści). Spróbuj innego pliku.',
    INVALID_AI_RESPONSE: 'Model AI zwrócił niepoprawne dane także przy ponownej próbie.',
    MISCONFIGURED: 'Backend ma nieprawidłową konfigurację dostawcy AI (klucz lub model).',
    INTERNAL: 'Wystąpił nieoczekiwany błąd serwera.',
  },
  notes: {
    skipped: (pages: string, count: number, limit: number) =>
      `${count === 1 ? 'Strona' : 'Strony'} ${pages} ${count === 1 ? 'wygląda' : 'wyglądają'} na skan i nie ${count === 1 ? 'została odczytana' : 'zostały odczytane'} (limit to ${String(limit)} zeskanowane strony).`,
    failed: (pages: string, count: number) =>
      `Nie udało się odczytać: ${count === 1 ? 'strona' : 'strony'} ${pages}.`,
    blank: (pages: string, count: number) =>
      `${count === 1 ? 'Strona' : 'Strony'} ${pages} ${count === 1 ? 'jest pusta i została pominięta' : 'są puste i zostały pominięte'}.`,
    cached: 'Ten plik był już analizowany. Pokazano zapisany wynik.',
  },
  types: {
    faktura: 'Faktura',
    umowa: 'Umowa',
    oferta: 'Oferta',
    raport: 'Raport',
    inne: 'Inny dokument',
  },
  pages: plPages,
  result: {
    type: 'Typ',
    date: 'Data',
    notGiven: 'nie podano',
    size: 'Objętość',
    analysed: 'Przeanalizowano',
    wholeDocument: 'cały dokument',
    partial: (read: number, total: number) => `${String(read)} z ${String(total)} stron`,
    language: 'Język',
    warnings: 'Na co uważać',
    summary: 'Podsumowanie',
    keyPoints: 'Najważniejsze punkty',
    amounts: (n: number) => `Kwoty (${String(n)})`,
    noAmounts: 'Dokument nie zawiera kwot.',
    amount: 'Kwota',
    concerns: 'Czego dotyczy',
    amountsTable: 'Tabela kwot (przewijana)',
    dates: (n: number) => `Daty (${String(n)})`,
    noDates: 'Dokument nie zawiera dat.',
    organisations: 'Organizacje',
    noOrganisations: 'Brak nazw organizacji.',
    people: 'Osoby',
    noPeople: 'Brak nazwisk.',
    keywords: 'Słowa kluczowe',
    noKeywords: 'Brak słów kluczowych.',
    meta: (model: string, when: string, chunks: number, ocr: string) =>
      `Model: ${model}. Przeanalizowano ${when}${chunks > 1 ? `, w ${String(chunks)} częściach` : ''}${ocr ? `. Strony odczytane ze skanu: ${ocr}` : ''}.`,
    notInText: 'nie znaleziono w tekście',
    notInTextTitle: 'Tej wartości nie znaleziono w tekście dokumentu',
    currencyMismatch: 'inna waluta w dokumencie',
    currencyMismatchTitle: 'W dokumencie ta wartość występuje tylko z inną walutą',
    fromInstruction: 'z podejrzanego polecenia',
    fromInstructionTitle:
      'Ta wartość występuje w dokumencie tylko w tekście wyglądającym na polecenie dla AI. Wynik mógł zostać zmanipulowany.',
    reanalyze: 'Przeanalizuj ten plik ponownie',
    next: 'Przeanalizuj kolejny plik',
  },
  view: {
    label: 'Język wyniku',
    original: (name: string) => `Oryginał (${name})`,
    translating: 'Tłumaczenie wyniku…',
    translationFailed: 'Nie udało się przetłumaczyć wyniku.',
    machineTranslation: (from: string, model: string) =>
      `Tłumaczenie maszynowe z języka ${from} (${model}). Kwoty, waluty i daty w danych pochodzą z oryginału.`,
    numbersVerified: 'Liczby i daty w przetłumaczonych tekstach zgadzają się z oryginałem.',
    numbersNotVerified:
      'Liczby lub daty w części tłumaczenia nie zgadzają się z oryginałem. Sprawdź:',
    issue: (i: NumericIssue) => `${i.field}: ${plIssue(i)}`,
  },
  history: {
    title: 'Ostatnie analizy',
    clear: 'Wyczyść historię',
    localOnly: 'Zapisane tylko w tej przeglądarce.',
    remove: (name: string) => `Usuń z historii: ${name}`,
  },
  downloads: {
    title: 'Pobierz',
    json: (lang: string) => `JSON (${lang})`,
    summary: (lang: string) => `Podsumowanie .md (${lang})`,
  },
  json: {
    title: 'Dane JSON',
    copy: 'Kopiuj',
    copied: 'Skopiowano',
    download: (name: string) => `Pobierz ${name}`,
    preview: 'Podgląd danych JSON',
  },
  documentTranslation: {
    title: 'Tłumaczenie całego dokumentu',
    intro: (to: string) =>
      `Cały tekst dokumentu zostanie przetłumaczony na ${to} strona po stronie. Liczby i daty na każdej stronie są porównywane z oryginałem.`,
    start: (to: string) => `Przetłumacz cały dokument (${to})`,
    progress: (done: number, total: number) => `Fragment ${String(done)} z ${String(total)}`,
    waiting: (s: number) => `Limit zapytań: wznowienie za ${String(s)} s`,
    cancel: 'Anuluj tłumaczenie',
    done: 'Gotowe.',
    download: (name: string) => `Pobierz ${name}`,
    allVerified: 'Liczby i daty na wszystkich stronach z tekstem zgadzają się z oryginałem.',
    someIssues: (n: number) =>
      `Na ${String(n)} ${n === 1 ? 'stronie' : 'stronach'} liczby lub daty wymagają sprawdzenia (lista w pliku).`,
    needsFile:
      'Aby przetłumaczyć cały dokument, wgraj plik ponownie (pełny tekst nie jest zapisywany w historii).',
    tooLong: (limit: string) =>
      `Dokument jest zbyt długi do tłumaczenia w całości (limit ${limit} znaków).`,
    failed: 'Tłumaczenie dokumentu nie powiodło się.',
  },
  exportText: {
    summaryTitle: (title: string) => `${title}: podsumowanie`,
    documentTitle: (title: string) => `${title}: tłumaczenie`,
    source: 'Plik źródłowy',
    type: 'Typ dokumentu',
    date: 'Data dokumentu',
    language: 'Język dokumentu',
    pages: 'Liczba stron',
    machineTranslation: (from: string, model: string, when: string) =>
      `Tłumaczenie maszynowe z języka ${from} (${model}, ${when}). Kwoty, waluty i daty pochodzą z oryginału.`,
    page: (n: number) => `Strona ${String(n)}`,
    check: 'Kontrola liczb i dat',
    scannedNotChecked: (pages: string) =>
      `Strony ze skanu (tłumaczone z obrazu, bez porównania liczb): ${pages}.`,
    issue: (i: NumericIssue) => `${i.field}: ${plIssue(i)}`,
  },
  credit: 'Autor:',
  creditLink: 'Strona autora (otwiera się w nowej karcie)',
  footer:
    'Tekst pliku (oraz obrazy stron bez warstwy tekstowej) jest wysyłany do zewnętrznego dostawcy AI (Google Gemini, a gdy jest niedostępny, Groq) w celu analizy i tłumaczenia. Sam plik PDF nie opuszcza przeglądarki. Demo korzysta z darmowych planów API, w których dostawca może wykorzystywać przesłane treści do ulepszania swoich usług. Nie wgrywaj dokumentów poufnych ani danych osobowych.',
};

export type Messages = typeof pl;

export const en: Messages = {
  appTagline: 'Upload a PDF and get a short summary plus structured data you can download as JSON.',
  interfaceLanguage: 'Interface language',
  languageNames: { pl: 'Polski', en: 'English' },
  configMissing:
    'The backend address (VITE_API_URL) is missing. Analysis will not work until it is set.',
  upload: {
    title: 'Drag a PDF file here',
    dragging: 'Drop the file to start the analysis',
    action: 'or choose it from your computer',
    hint: 'PDF up to 10 MB. Scanned pages are read too. The file content is sent for analysis to an external AI API.',
  },
  emptyHint: 'No analyses yet. Contracts, invoices, offers and reports work well.',
  progress: {
    steps: {
      upload: 'Upload',
      reading: 'Reading text',
      analyzing: 'AI analysis',
      result: 'Result',
    },
    opening: 'Opening the file',
    page: (done, total) => `Page ${String(done)} of ${String(total)}`,
    analyzing: 'The model is reading the document and filling in the data schema',
    cancel: 'Cancel',
  },
  error: {
    title: 'The analysis failed',
    details: 'Technical details',
    retry: 'Try again',
    chooseOther: 'Choose another file',
  },
  errors: {
    NOT_PDF: 'This is not a PDF file. Choose a file with the .pdf extension.',
    EMPTY: 'The file is empty.',
    TOO_LARGE: (size) => `The file is ${size}. The maximum size is 10 MB.`,
    BAD_SIGNATURE: 'The file has a .pdf extension, but its content is not a PDF.',
    PASSWORD: 'The file is password-protected. Remove the password and try again.',
    CORRUPT: 'The file could not be opened. It may be damaged.',
    UNREADABLE:
      'Your browser could not read any page of this file. Try the latest Chrome, Edge, Firefox or Safari.',
    TOO_MANY_PAGES: (n) => `The file has ${String(n)} pages. The limit is 2,000 pages.`,
    TOO_MUCH_TEXT: (limit, page, total) =>
      `The document has more than ${limit} characters of text (exceeded on page ${String(page)} of ${String(total)}). Try a shorter file.`,
    NO_TEXT: 'There is no text to analyse in this file.',
    UNEXPECTED: 'An unexpected error occurred. Please try again.',
    NO_API_URL: 'The backend address (VITE_API_URL) is missing. The app is misconfigured.',
    TIMEOUT: 'The analysis took too long. Please try again.',
    NETWORK: 'Cannot reach the analysis server. Check your connection and try again.',
    BAD_RESPONSE: (status) =>
      `The server returned an unreadable response (HTTP ${String(status)}).`,
    SCHEMA: 'The analysis result does not match the data schema.',
    BAD_REQUEST: 'The request data is invalid.',
    FORBIDDEN_ORIGIN: 'This domain is not allowed to use the API.',
    PAYLOAD_TOO_LARGE: 'The document is too large to analyse. Try a shorter file.',
    RATE_LIMITED: 'Too many requests in a short time. Wait a minute and try again.',
    AI_RATE_LIMITED: 'The AI provider rate limit was reached. Try again in a minute.',
    AI_UNAVAILABLE: 'The AI service is temporarily unavailable.',
    AI_TIMEOUT: 'The analysis took too long. Try a shorter file.',
    AI_REFUSED:
      'The AI provider refused to process this document (content filter). Try another file.',
    INVALID_AI_RESPONSE: 'The AI model returned invalid data, also on the second attempt.',
    MISCONFIGURED: 'The backend AI provider is misconfigured (key or model).',
    INTERNAL: 'An unexpected server error occurred.',
  },
  notes: {
    skipped: (pages, count, limit) =>
      `${count === 1 ? 'Page' : 'Pages'} ${pages} ${count === 1 ? 'looks' : 'look'} scanned and ${count === 1 ? 'was' : 'were'} not read (the limit is ${String(limit)} scanned pages).`,
    failed: (pages, count) => `Could not read ${count === 1 ? 'page' : 'pages'} ${pages}.`,
    blank: (pages, count) =>
      `${count === 1 ? 'Page' : 'Pages'} ${pages} ${count === 1 ? 'is blank and was' : 'are blank and were'} skipped.`,
    cached: 'This file was analysed before. Showing the saved result.',
  },
  types: {
    faktura: 'Invoice',
    umowa: 'Contract',
    oferta: 'Offer',
    raport: 'Report',
    inne: 'Other document',
  },
  pages: (n) => (n === 1 ? '1 page' : `${n.toLocaleString('en-GB')} pages`),
  result: {
    type: 'Type',
    date: 'Date',
    notGiven: 'not stated',
    size: 'Length',
    analysed: 'Analysed',
    wholeDocument: 'whole document',
    partial: (read, total) => `${String(read)} of ${String(total)} pages`,
    language: 'Language',
    warnings: 'Things to check',
    summary: 'Summary',
    keyPoints: 'Key points',
    amounts: (n) => `Amounts (${String(n)})`,
    noAmounts: 'The document contains no amounts.',
    amount: 'Amount',
    concerns: 'What it is for',
    amountsTable: 'Amounts table (scrollable)',
    dates: (n) => `Dates (${String(n)})`,
    noDates: 'The document contains no dates.',
    organisations: 'Organisations',
    noOrganisations: 'No organisation names.',
    people: 'People',
    noPeople: 'No names of people.',
    keywords: 'Keywords',
    noKeywords: 'No keywords.',
    meta: (model, when, chunks, ocr) =>
      `Model: ${model}. Analysed ${when}${chunks > 1 ? `, in ${String(chunks)} parts` : ''}${ocr ? `. Pages read from scans: ${ocr}` : ''}.`,
    notInText: 'not found in text',
    notInTextTitle: 'This value was not found in the document text',
    currencyMismatch: 'different currency in document',
    currencyMismatchTitle: 'In the document this value appears only with a different currency',
    fromInstruction: 'from a suspicious instruction',
    fromInstructionTitle:
      'This value appears in the document only inside text that looks like an instruction to an AI. The result may have been manipulated.',
    reanalyze: 'Analyse this file again',
    next: 'Analyse another file',
  },
  view: {
    label: 'Result language',
    original: (name) => `Original (${name})`,
    translating: 'Translating the result…',
    translationFailed: 'The result could not be translated.',
    machineTranslation: (from, model) =>
      `Machine translation from ${from} (${model}). Amounts, currencies and dates in the data come from the original.`,
    numbersVerified: 'Numbers and dates in the translated texts match the original.',
    numbersNotVerified:
      'Some numbers or dates in the translation do not match the original. Check:',
    issue: (i) => `${i.field}: ${enIssue(i)}`,
  },
  history: {
    title: 'Recent analyses',
    clear: 'Clear history',
    localOnly: 'Stored only in this browser.',
    remove: (name) => `Remove from history: ${name}`,
  },
  downloads: {
    title: 'Download',
    json: (lang) => `JSON (${lang})`,
    summary: (lang) => `Summary .md (${lang})`,
  },
  json: {
    title: 'JSON data',
    copy: 'Copy',
    copied: 'Copied',
    download: (name) => `Download ${name}`,
    preview: 'JSON data preview',
  },
  documentTranslation: {
    title: 'Translate the whole document',
    intro: (to) =>
      `The full document text will be translated into ${to} page by page. Numbers and dates on every page are compared with the original.`,
    start: (to) => `Translate the whole document (${to})`,
    progress: (done, total) => `Part ${String(done)} of ${String(total)}`,
    waiting: (s) => `Rate limit reached: resuming in ${String(s)} s`,
    cancel: 'Cancel translation',
    done: 'Done.',
    download: (name) => `Download ${name}`,
    allVerified: 'Numbers and dates on all text pages match the original.',
    someIssues: (n) =>
      `On ${String(n)} ${n === 1 ? 'page' : 'pages'} numbers or dates need checking (listed in the file).`,
    needsFile:
      'To translate the whole document, upload the file again (the full text is not stored in history).',
    tooLong: (limit) =>
      `The document is too long to translate in full (limit ${limit} characters).`,
    failed: 'The document translation failed.',
  },
  exportText: {
    summaryTitle: (title) => `${title}: summary`,
    documentTitle: (title) => `${title}: translation`,
    source: 'Source file',
    type: 'Document type',
    date: 'Document date',
    language: 'Document language',
    pages: 'Pages',
    machineTranslation: (from, model, when) =>
      `Machine translation from ${from} (${model}, ${when}). Amounts, currencies and dates come from the original.`,
    page: (n) => `Page ${String(n)}`,
    check: 'Number and date check',
    scannedNotChecked: (pages) =>
      `Scanned pages (translated from the image, numbers not compared): ${pages}.`,
    issue: (i) => `${i.field}: ${enIssue(i)}`,
  },
  credit: 'Built by',
  creditLink: "Author's website (opens in a new tab)",
  footer:
    'The file text (and images of pages without a text layer) is sent to an external AI provider (Google Gemini, or Groq when Gemini is unavailable) for analysis and translation. The PDF itself never leaves your browser. This demo uses free API tiers, under which the provider may use submitted content to improve its services. Do not upload confidential documents or personal data.',
};

export const MESSAGES: Record<Lang, Messages> = { pl, en };

/** Komunikat dla kodu błędu z backendu lub klienta; gdy kod jest nieznany, zostaje tekst zapasowy. */
export function errorText(t: Messages, code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  const value: unknown = (t.errors as Record<string, unknown>)[code];
  return typeof value === 'string' ? value : fallback;
}
