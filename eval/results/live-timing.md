# Pomiar demo z perspektywy osoby z zewnątrz

Adres: https://aeternifrigus.github.io/pdf-insight/. Data: 2026-10-06T04:38:53.207Z. Plik: Test_PDF_Insight_umowa_14-2026.pdf. Każdy przebieg w nowej przeglądarce, bez pamięci podręcznej i historii.

## Podsumowanie (3 przebiegi na profil)

| Warunki | Udane | Mediana do podsumowania | Najgorszy | Limit 30 s |
| --- | :-: | --: | --: | :-: |
| Zwykłe łącze (komputer) | 3/3 | 13.7 s | 17.7 s | ✓ |
| Wolny internet mobilny (1,6 Mb/s, 150 ms, CPU ×4) | 3/3 | 17.6 s | 17.7 s | ✓ |

## Przebiegi

| Warunki | Przebieg | Wczytanie strony | Od wgrania pliku do podsumowania | Limit 30 s | Model | Uwagi |
| --- | :-: | --: | --: | :-: | --- | --- |
| Zwykłe łącze (komputer) | 1 | 0.8 s | 13.7 s | ✓ | gemini-3.5-flash | OCR skanów: 11 |
| Zwykłe łącze (komputer) | 2 | 0.3 s | 17.7 s | ✓ | gemini-3.5-flash | OCR skanów: 11 |
| Zwykłe łącze (komputer) | 3 | 0.6 s | 8.3 s | ✓ | gemini-3.5-flash-lite | OCR skanów: 11 |
| Wolny internet mobilny (1,6 Mb/s, 150 ms, CPU ×4) | 1 | 1.2 s | 16.7 s | ✓ | gemini-3.5-flash-lite | OCR skanów: nie zdążył |
| Wolny internet mobilny (1,6 Mb/s, 150 ms, CPU ×4) | 2 | 1.2 s | 17.7 s | ✓ | gemini-3.5-flash-lite | OCR skanów: nie zdążył |
| Wolny internet mobilny (1,6 Mb/s, 150 ms, CPU ×4) | 3 | 1.2 s | 17.6 s | ✓ | gemini-3.5-flash-lite | OCR skanów: nie zdążył |
