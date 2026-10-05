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
- **Skany przez model multimodalny zamiast Tesseract.** Strona z mniej niż 30 znakami tekstu jest renderowana do JPEG i wysyłana razem z tekstem. Gemini czyta polski tekst ze skanu lepiej niż Tesseract w przeglądarce i nie trzeba pobierać ok. 10 MB danych językowych. W testowej umowie to właśnie skan (Załącznik 5, aneks) zmienia abonament i liczbę użytkowników.
- **Długie dokumenty: map-reduce.** Tekst dzielony jest po granicach stron na fragmenty do 60 tys. znaków. Każdy fragment jest analizowany osobno (maks. 3 równolegle, ze względu na limity darmowego API), listy są łączone deterministycznie z usunięciem duplikatów, a podsumowanie całości powstaje w osobnym, krótkim wywołaniu.
- **Brak routingu.** Aplikacja ma jeden widok, więc nie ma problemu odświeżania podstron na GitHub Pages (nie są potrzebne HashRouter ani `404.html`). `base` w Vite ustawiany jest w CI z nazwy repozytorium, a worker pdf.js importowany jest przez `?url`, więc działa pod ścieżką `/<repo>/`.
- **pdf.js ładowany leniwie** przy pierwszym pliku, żeby pierwsze wyświetlenie strony było szybkie.

### Bezpieczeństwo

- Klucz API istnieje tylko jako sekret Cloudflare (`GEMINI_API_KEY`). W repozytorium jest wyłącznie `.env.example` i `worker/.dev.vars.example`; `.env` i `.dev.vars` są w `.gitignore`.
- CORS: backend odpowiada tylko originom z `ALLOWED_ORIGINS` (domena GitHub Pages i localhost). Żądania z przeglądarki z innej domeny dostają 403.
- Limity: 10 MB na plik (frontend), 8 MB na żądanie, 400 tys. znaków tekstu, maks. 4 obrazy, 10 analiz na minutę na adres IP (binding Cloudflare Rate Limiting plus limit w pamięci jako druga warstwa).
- **Prompt injection.** Treść PDF to dane, nie instrukcje:
  - wszystkie instrukcje są w wiadomości systemowej, a treść dokumentu trafia do modelu w bloku `<document_NONCE>` z losowym znacznikiem, którego dokument nie zna i nie może zamknąć (znaczniki w treści są neutralizowane);
  - model ma jawnie zakazane wykonywanie poleceń z dokumentu i ma je zgłosić w ostrzeżeniach;
  - niezależnie od modelu działa heurystyka (PL/EN/DE), która wykrywa typowe frazy i pokazuje użytkownikowi ostrzeżenie;
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

Vitest, 46 testów jednostkowych:

- `src/lib/schema.test.ts`: walidacja schematu (wymagane pola, ISO 8601, ISO 4217, ISO 639-1, liczba zdań i punktów, dodatkowe pola, limity żądania);
- `src/lib/text.test.ts`: licznik zdań, składanie tekstu z pdf.js, wykrywanie prompt injection, podział na fragmenty, łączenie wyników;
- `src/lib/history.test.ts`: historia w `localStorage` (limit, uszkodzone dane);
- `worker/src/worker.test.ts`: analiza z atrapą LLM (ponowienie po błędnej odpowiedzi, błąd po drugiej próbie, map-reduce, obrazy skanów, izolacja treści dokumentu), CORS, limit rozmiaru i liczby żądań.

## Znane ograniczenia

- **OCR** obejmuje maks. 4 strony bez warstwy tekstowej na dokument (limit rozmiaru żądania i czasu odpowiedzi). Pominięte strony są wymienione w ostrzeżeniu.
- **Darmowy limit Gemini** (kilka–kilkanaście zapytań na minutę) przy wielu użytkownikach naraz kończy się komunikatem „spróbuj ponownie za minutę”. Długi dokument zużywa kilka zapytań.
- **Bardzo długie dokumenty:** limit to ok. 400 tys. znaków (ok. 150–200 stron tekstu).
- **CORS chroni przed innymi stronami w przeglądarce, ale nie przed skryptami**, które podrobią nagłówek `Origin`. Przed nadużyciem chronią wtedy limit żądań i limity rozmiaru; pełną ochronę dałby np. Cloudflare Turnstile.
- **Licznik zdań jest heurystyczny.** Rzadkie skróty mogą zaniżyć lub zawyżyć wynik; wtedy działa mechanizm ponownej próby.
- **Wykrywanie prompt injection jest heurystyczne.** Nowe sformułowania mogą go ominąć; główną ochroną jest izolacja treści w prompcie i ścisła walidacja wyniku.
- **Jakość danych zależy od modelu.** Model może pominąć kwotę lub datę z długich tabel (np. cennika), dlatego ma polecenie wybrać maks. 30 najważniejszych.
- Tekst w PDF-ach z nietypowym kodowaniem fontów może zostać odczytany błędnie (ograniczenie pdf.js).
- Historia jest zapisywana tylko w tej przeglądarce i zawiera wyniki analiz (bez samych plików).

## Praca z AI

Przebieg pracy z narzędziami AI, kluczowe prompty i poprawione błędy opisuje [AI_LOG.md](AI_LOG.md).
