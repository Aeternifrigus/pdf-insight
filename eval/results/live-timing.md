# Pomiar demo z perspektywy osoby z zewnątrz

Adres: https://aeternifrigus.github.io/pdf-insight/. Data: 2026-10-06T04:22:03.535Z. Plik: Test_PDF_Insight_umowa_14-2026.pdf. Każdy przebieg w nowej przeglądarce, bez pamięci podręcznej i historii.

## Podsumowanie (3 przebiegi na profil)

| Warunki | Udane | Mediana do podsumowania | Najgorszy | Limit 30 s |
| --- | :-: | --: | --: | :-: |
| Zwykłe łącze (komputer) | 3/3 | 14.3 s | 14.5 s | ✓ |
| Wolny internet mobilny (1,6 Mb/s, 150 ms, CPU ×4) | 3/3 | 24.1 s | 27.8 s | ✓ |

## Przebiegi

| Warunki | Przebieg | Wczytanie strony | Od wgrania pliku do podsumowania | Limit 30 s | Model | Uwagi |
| --- | :-: | --: | --: | :-: | --- | --- |
| Zwykłe łącze (komputer) | 1 | 1.3 s | 14.3 s | ✓ | gemini-3.5-flash | OCR skanów: 11 |
| Zwykłe łącze (komputer) | 2 | 0.5 s | 14.5 s | ✓ | gemini-3.5-flash | OCR skanów: 11 |
| Zwykłe łącze (komputer) | 3 | 0.7 s | 8.2 s | ✓ | gemini-3.5-flash-lite | OCR skanów: 11 |
| Wolny internet mobilny (1,6 Mb/s, 150 ms, CPU ×4) | 1 | 1.1 s | 27.8 s | ✓ | gemini-3.8-flash | OCR skanów: nie zdążył |
| Wolny internet mobilny (1,6 Mb/s, 150 ms, CPU ×4) | 2 | 1.2 s | 24.1 s | ✓ | gemini-3.5-flash | OCR skanów: nie zdążył |
| Wolny internet mobilny (1,6 Mb/s, 150 ms, CPU ×4) | 3 | 1.2 s | 16.8 s | ✓ | gemini-3.5-flash-lite | OCR skanów: nie zdążył |
