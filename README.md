# PDF Insight

Aplikacja webowa, która wczytuje plik PDF, tworzy jego krótkie podsumowanie i zamienia treść w uporządkowane dane JSON zgodne ze schematem z briefu.

**Demo:** https://aeternifrigus.github.io/pdf-insight/

![Zrzut ekranu: wynik analizy umowy testowej](docs/screenshot.png)

## Co potrafi

| Wymaganie                                                             | Status                      | Gdzie                                                           |
| --------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| F-01 Wgrywanie PDF (drag & drop, wybór pliku, tylko PDF, maks. 10 MB) | ✅                          | `src/components/UploadZone.tsx`, `src/lib/file.ts`              |
| F-02 Odczyt tekstu z warstwy tekstowej                                | ✅                          | `src/lib/pdf.ts`, `src/lib/textItems.ts`                        |
| F-03 Podsumowanie 3–5 zdań w języku dokumentu                         | ✅ (walidowane)             | `worker/src/prompt.ts`, `src/lib/sentences.ts`                  |
| F-04 Dane zgodne ze schematem, walidowane przed wyświetleniem         | ✅ Zod, backend i frontend  | `src/lib/schema.ts`                                             |
| F-05 Widok wyników, podgląd i pobranie `.json`                        | ✅                          | `src/components/ResultView.tsx`, `JsonPreview.tsx`              |
| F-06 Stany: ładowanie, błąd z ponowieniem, stan pusty                 | ✅                          | `ProgressPanel.tsx`, `ErrorPanel.tsx`, `App.tsx`                |
| F-07 Publiczne demo na GitHub Pages                                   | ✅                          | `.github/workflows/deploy.yml`                                  |
| F-08 Długie dokumenty: podział na fragmenty i łączenie                | ✅ map-reduce               | `src/lib/chunk.ts`, `src/lib/merge.ts`, `worker/src/analyze.ts` |
| F-09 Historia analiz w przeglądarce                                   | ✅ ostatnie 8               | `src/lib/history.ts`                                            |
| F-10 OCR skanów                                                       | ✅ przez model multimodalny | `src/lib/pdf.ts` (render strony do JPEG)                        |

## Architektura

```
Przeglądarka (React SPA, GitHub Pages)          Cloudflare Worker (API proxy)              Google Gemini
┌──────────────────────────────────┐   POST    ┌──────────────────────────────────┐        ┌────────────┐
│ 1. walidacja pliku (%PDF-, 10 MB) │ /analyze  │ CORS (tylko domena demo)          │        │            │
│ 2. pdf.js: tekst każdej strony    │ ────────▶ │ limit żądań (10/min/IP) i rozmiaru│ ─────▶ │ LLM (JSON) │
│ 3. strony bez tekstu → JPEG       │  tekst +  │ walidacja żądania (Zod)           │        │            │
│ 4. walidacja wyniku (Zod)         │  obrazy   │ prompt: treść PDF = dane          │ ◀───── │            │
│ 5. widok, JSON, historia          │ ◀──────── │ walidacja odpowiedzi + 1 ponowienie│        └────────────┘
└──────────────────────────────────┘   JSON    └──────────────────────────────────┘
```

Struktura katalogów:

```
src/
  api/          klient HTTP backendu (timeout, błędy, walidacja odpowiedzi)
  components/   komponenty UI
  lib/          logika bez UI: schemat Zod, pdf.js, podział tekstu, łączenie wyników,
                wykrywanie prompt injection, historia; współdzielona z backendem
worker/src/     backend: router HTTP, CORS, limity, prompty, klient LLM, analiza
```

### Decyzje

- **Cloudflare Workers jako backend.** Darmowy plan wystarcza z dużym zapasem, nie usypia się jak darmowe serwery, a klucz API trzymany jest jako sekret Workera (`wrangler secret put`). Frontend zna tylko publiczny adres API.
- **PDF nie opuszcza przeglądarki.** Tekst wyciąga pdf.js po stronie klienta, a do backendu trafia wyłącznie tekst stron i obrazy stron zeskanowanych. Dzięki temu żądania są małe, a limit 10 MB dotyczy pliku, nie transferu.
- **Jeden schemat Zod dla frontendu i backendu** (`src/lib/schema.ts`). Backend waliduje odpowiedź modelu i przy błędzie robi dokładnie jedną ponowną próbę, przekazując modelowi listę błędów. Frontend waliduje wynik ponownie przed wyświetleniem i nie ufa ślepo backendowi.
- **Pola wyliczane deterministycznie nie pochodzą od modelu.** `fileName` i `pages` ustawia kod, model nie może ich zmienić. Dodane pole `analysis` (model, data, liczba fragmentów, strony ze skanu, ostrzeżenia) jest dozwolone przez brief („pola można dodawać”).
- **Walidacja jest ścisła tam, gdzie brief stawia twarde reguły:** język ISO 639-1, waluta z listy ISO 4217, prawdziwa data kalendarzowa ISO 8601, 3–7 punktów, 3–5 zdań (licznik zdań z obsługą polskich skrótów i inicjałów). Drobne różnice formatu (np. `zł` zamiast `PLN`, liczba jako tekst) są normalizowane przed walidacją, ale treść nie jest zgadywana.
- **Skany przez model multimodalny zamiast Tesseract.** Strona bez użytecznej warstwy tekstowej jest renderowana do JPEG i wysyłana razem z tekstem. Za skan uznajemy stronę z mniej niż 30 znakami tekstu albo stronę z obrazem i mniej niż 400 znakami (skan z dodanym nagłówkiem lub pieczątką archiwum, którego sam próg znaków nie wyłapie). Przy limicie 4 obrazów pierwszeństwo mają strony z najmniejszą ilością tekstu. Puste strony są pomijane (pusty obraz zachęca model do zmyślania). Z aplikacją publikowane są dekodery WASM pdf.js (JPEG 2000, JBIG2), bez których typowe skany archiwalne renderują się na biało. Gemini czyta polski tekst ze skanu lepiej niż Tesseract w przeglądarce i nie trzeba pobierać ok. 10 MB danych językowych. W testowej umowie to właśnie skan (Załącznik 5, aneks) zmienia abonament i liczbę użytkowników.
- **Długie dokumenty: map-reduce.** Tekst dzielony jest po granicach stron na fragmenty do 150 tys. znaków (ok. 40 tys. tokenów, model ma okno 1 mln), więc nawet dokument z limitem to maks. 3 fragmenty i 1 wywołanie łączące, co mieści się w darmowym limicie zapytań. Fragmenty są analizowane maks. po 2 równolegle, listy są łączone deterministycznie z usunięciem duplikatów, a podsumowanie całości powstaje w osobnym, krótkim wywołaniu.
- **Brak routingu.** Aplikacja ma jeden widok, więc nie ma problemu odświeżania podstron na GitHub Pages (nie są potrzebne HashRouter ani `404.html`). `base` w Vite ustawiany jest w CI z nazwy repozytorium, a worker pdf.js importowany jest przez `?url`, więc działa pod ścieżką `/<repo>/`.
- **pdf.js ładowany leniwie** przy pierwszym pliku, żeby pierwsze wyświetlenie strony było szybkie.

### Bezpieczeństwo

- Klucz API istnieje tylko jako sekret Cloudflare (`GEMINI_API_KEY`). W repozytorium jest wyłącznie `.env.example` i `worker/.dev.vars.example`; `.env` i `.dev.vars` są w `.gitignore`.
- CORS: backend odpowiada tylko originom z `ALLOWED_ORIGINS` (domena GitHub Pages i localhost). Żądania z przeglądarki z innej domeny dostają 403.
- Limity: 10 MB na plik (frontend), 4 MB na żądanie, 400 tys. znaków tekstu, maks. 4 obrazy po 600 tys. znaków base64, 10 analiz na minutę na adres IP (binding Cloudflare Rate Limiting plus limit w pamięci jako druga warstwa). Rozmiar żądania jest dobrany tak, żeby parsowanie i walidacja najgorszego przypadku zajmowały kilka ms CPU (darmowy plan Workers ma 10 ms na żądanie).
- Content-Security-Policy (jako `<meta>`, bo GitHub Pages nie ustawia nagłówków): skrypty i fonty tylko z własnej domeny, połączenia tylko do własnej domeny i API, bez `eval` (jedynie `wasm-unsafe-eval` dla dekoderów pdf.js). Fonty są serwowane lokalnie, bez zapytań do Google Fonts.
- Analiza ma budżet 100 s po stronie backendu (klient czeka 120 s), więc Worker nie zużywa limitu API po tym, jak przeglądarka przestała czekać. Treść błędów dostawcy AI trafia tylko do logów Workera.
- **Prompt injection.** Treść PDF to dane, nie instrukcje:
  - wszystkie instrukcje są w wiadomości systemowej, a treść dokumentu trafia do modelu w bloku `<document_NONCE>` z losowym znacznikiem, którego dokument nie zna i nie może zamknąć (znaczniki w treści są neutralizowane);
  - nazwa pliku (też kontrolowana przez użytkownika) w ogóle nie trafia do modelu;
  - model ma jawnie zakazane wykonywanie poleceń z dokumentu i ma je zgłosić w ostrzeżeniach;
  - niezależnie od modelu działa heurystyka (PL/EN/DE, odporna na brak polskich znaków), która wykrywa typowe frazy i pokazuje użytkownikowi ostrzeżenie;
  - wynik jest ściśle walidowany schematem i renderowany wyłącznie jako tekst (bez `dangerouslySetInnerHTML`, reguła ESLint to wymusza).
    Testowa umowa zawiera ukrytą instrukcję (strona 4, tekst 5 pt), która każe napisać, że umowa jest nieważna i warta 1 PLN. Aplikacja ją ignoruje i pokazuje ostrzeżenie.
- Użytkownik widzi informację, że treść pliku trafia do zewnętrznego API AI (przy polu wgrywania i w stopce).
- Szczegóły błędów wewnętrznych nie trafiają do klienta.

## Uruchomienie lokalne

Wymagania: Node.js 22+, darmowy klucz [Google AI Studio](https://aistudio.google.com/apikey).

```bash
npm ci

# Backend
cp worker/.dev.vars.example worker/.dev.vars   # wpisz GEMINI_API_KEY
npm run dev:worker                              # http://localhost:8787

# Frontend (w drugim terminalu)
cp .env.example .env.local                      # VITE_API_URL=http://localhost:8787
npm run dev                                     # http://localhost:5173/pdf-insight/
```

Pozostałe polecenia: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run format`.

### Zmienne środowiskowe

| Zmienna                    | Gdzie                                               | Opis                                                              |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `VITE_API_URL`             | frontend (`.env.local`, w CI: zmienna repozytorium) | adres Workera, bez końcowego `/`                                  |
| `VITE_BASE_PATH`           | frontend (ustawiane w CI)                           | ścieżka GitHub Pages, domyślnie `/pdf-insight/`                   |
| `GEMINI_API_KEY`           | Worker, sekret                                      | klucz Google AI Studio                                            |
| `GEMINI_MODEL`             | Worker, `wrangler.toml`                             | domyślnie `gemini-2.5-flash`                                      |
| `ALLOWED_ORIGINS`          | Worker, `wrangler.toml`                             | dozwolone originy, oddzielone przecinkami                         |
| `LLM_PROVIDER`, `OPENAI_*` | Worker                                              | opcjonalnie dowolne API zgodne z OpenAI (np. Groq) zamiast Gemini |

## Wdrożenie

1. **Backend:** `npx wrangler login`, potem `npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml` i `npm run deploy:worker`. Wrangler wypisze adres `https://pdf-insight-api.<konto>.workers.dev`.
2. **Frontend:** w repozytorium GitHub ustaw _Settings → Pages → Source: GitHub Actions_ oraz zmienną _Settings → Secrets and variables → Actions → Variables → `VITE_API_URL`_. Każdy push do `main` uruchamia `lint → build → deploy`.
3. Opcjonalnie: sekrety `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID` włączają automatyczny deploy Workera (`.github/workflows/worker.yml`).

## Testy

Vitest, 69 testów jednostkowych:

- `src/lib/schema.test.ts`: walidacja schematu (wymagane pola, ISO 8601, ISO 4217, ISO 639-1, liczba zdań i punktów, dodatkowe pola) i żądania (limity, powtórzone strony, obrazy dla nieistniejących stron);
- `src/lib/text.test.ts`: licznik zdań, składanie tekstu z pdf.js (także strony obrócone), wykrywanie prompt injection, podział na fragmenty, łączenie wyników;
- `src/lib/scan.test.ts`: wybór stron do odczytu ze skanu, wykrywanie pustych stron, skala renderowania;
- `src/lib/history.test.ts`: historia w `localStorage` (limit, uszkodzone dane);
- `src/api/analyze.test.ts`: limit czasu i anulowanie żądania;
- `worker/src/worker.test.ts`: analiza z atrapą LLM (ponowienie po błędnej odpowiedzi, błąd po drugiej próbie, map-reduce, obrazy skanów, izolacja treści dokumentu i nazwy pliku, HTTP 429, budżet czasu, ukrywanie błędów dostawcy, normalizacja formatów), CORS, limit rozmiaru i liczby żądań.

### Przypadki brzegowe sprawdzone w przeglądarce

Każdy plik przeszedł przez prawdziwy interfejs w headless Chromium (z atrapą modelu AI):

| Plik                                                              | Wynik                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Umowa testowa (12 stron, ukryta instrukcja 5 pt, aneks jako skan) | tekst 11 stron, strona 11 wysłana jako obraz, ostrzeżenie o stronie 4          |
| Skan z dodanym nagłówkiem tekstowym                               | rozpoznany jako skan i odczytany (wcześniej treść ginęła)                      |
| Skan zapisany w JPEG 2000                                         | poprawnie zdekodowany (wcześniej biała strona)                                 |
| 6 stron skanów                                                    | 4 odczytane, ostrzeżenie o stronach 5 i 6                                      |
| Pusta strona                                                      | komunikat „W pliku nie ma tekstu do analizy” zamiast pustego obrazu dla modelu |
| Paragon 200 × 14 000 pt                                           | render ograniczony do 4 mln pikseli (bez przekroczenia limitu canvas)          |
| PDF z hasłem / uszkodzony / 11 MB / HTML z rozszerzeniem .pdf     | czytelny komunikat, bez przycisku ponowienia                                   |
| Biały tekst „Ignore all previous instructions”                    | ostrzeżenie dla użytkownika                                                    |
| Szerokość 360 px                                                  | brak poziomego przewijania                                                     |
| CSP                                                               | brak naruszeń w konsoli                                                        |

## Znane ograniczenia

- **OCR** obejmuje maks. 4 strony bez warstwy tekstowej na dokument (limit rozmiaru żądania i czasu odpowiedzi). Pominięte strony są wymienione w ostrzeżeniu.
- **Strony mieszane** (dużo tekstu plus wklejony skan, np. pieczątka z treścią) nie są renderowane, więc treść samego obrazu jest pomijana.
- **Bardzo długie strony** (np. paragony) są renderowane w niższej rozdzielczości; drobny tekst może być nieczytelny dla modelu. Lepsze byłoby cięcie strony na kafelki.
- **Ukryty tekst** (biały, mikroskopijny, poza stroną) nie jest osobno wykrywany. Trafia do modelu jako dane i jest sygnalizowany tylko wtedy, gdy wygląda na polecenie.
- **Prywatność:** demo działa na darmowym planie Gemini API, w którym Google może wykorzystywać przesłane treści do ulepszania usług. Aplikacja ostrzega o tym użytkownika; do dokumentów poufnych potrzebny byłby plan płatny.
- **Darmowy limit Gemini** (kilka–kilkanaście zapytań na minutę) przy wielu użytkownikach naraz kończy się komunikatem „spróbuj ponownie za minutę” (po jednej automatycznej próbie z odczekaniem). Długi dokument zużywa do 4 zapytań.
- **Alternatywny dostawca zgodny z OpenAI** (np. Groq) ma na darmowym planie niskie limity tokenów na minutę; duże fragmenty 150 tys. znaków mogą ich nie zmieścić. Nazwę modelu warto sprawdzić przed użyciem.
- **Bardzo długie dokumenty:** limit to ok. 400 tys. znaków (ok. 150–200 stron tekstu).
- **CORS chroni przed innymi stronami w przeglądarce, ale nie przed skryptami**, które podrobią nagłówek `Origin`. Przed nadużyciem chronią wtedy limit żądań i limity rozmiaru; pełną ochronę dałby np. Cloudflare Turnstile.
- **Licznik zdań jest heurystyczny.** Rzadkie skróty mogą zaniżyć lub zawyżyć wynik; wtedy działa mechanizm ponownej próby.
- **Wykrywanie prompt injection jest heurystyczne.** Nowe sformułowania mogą go ominąć; główną ochroną jest izolacja treści w prompcie i ścisła walidacja wyniku.
- **Jakość danych zależy od modelu.** Model może pominąć kwotę lub datę z długich tabel (np. cennika), dlatego ma polecenie wybrać maks. 30 najważniejszych.
- Tekst w PDF-ach z nietypowym kodowaniem fontów może zostać odczytany błędnie (ograniczenie pdf.js).
- Historia jest zapisywana tylko w tej przeglądarce i zawiera wyniki analiz (bez samych plików).

## Praca z AI

Przebieg pracy z narzędziami AI, kluczowe prompty i poprawione błędy opisuje [AI_LOG.md](AI_LOG.md).
