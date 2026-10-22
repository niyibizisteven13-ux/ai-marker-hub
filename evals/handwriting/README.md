# Handwriting recognition evaluation set

Put real pages here, each with a ground-truth transcription that a person has checked:

```
evals/handwriting/
  page-001.jpg   page-001.txt
  notes-math.pdf notes-math.txt
```

- The `.txt` must contain exactly what is written on the page, in reading order. Use one blank line between regions and keep spelling mistakes as written.
- Cover what Bwenge.AI actually sees: English, Kinyarwanda, French and mixed notes; faint pencil; rotated phone photos; equations; tables; crossed-out words.
- Only add pages you are allowed to store. Remove names and student IDs first.

Run (needs a configured vision model, e.g. `AI_AGENT_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`):

```
npm run eval:documents                  # all files
npm run eval:documents -- --no-ocr      # skip the Tesseract cross-check
```

The report goes to `evals/reports/handwriting-<timestamp>.json` and contains, per file:
- CER and WER, with substitutions, deletions and insertions;
- how many elements were flagged for review, and how many were corroborated or contradicted by OCR;
- time taken and tokens used.

Each run calls the model, so it costs money. Track CER/WER across model, prompt or preprocessing changes before adopting them.
