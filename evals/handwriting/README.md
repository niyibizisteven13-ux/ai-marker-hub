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

## Accuracy report: by condition, kind of writing and language

```
npm run eval:accuracy                                  # your real pages, as they are
npm run eval:accuracy -- --degrade                     # also as a phone would take them, with and without the cleanup
npm run eval:accuracy -- --chat                        # through the chat path (what a user's photo gets)
npm run eval:accuracy -- --degrade --conditions desk_shadow,dim --limit 10
```

Add an optional `page-001.json` next to a page to label it for the report (labels never change how the page is read):

```json
{ "tags": ["pencil", "maths", "table"], "language": "rw" }
```

The report pools errors exactly (total wrong characters over total characters), and shows:
- **overall, by condition, by tag, by language**;
- **what the cleanup is worth**: each degraded condition (`desk_shadow`, `dim`, `blurred`, `low_res`, `tilted`) is read as it is and after cleanup, so you see the cost of each camera problem and how much is won back. A line marked `WORSE` means the cleanup hurt and must be fixed before it is relied on;
- readings that **failed**, counted as fully wrong, never as a pass.

`--degrade` needs only your clean pages: it makes the phone-photo versions itself. It does not replace real phone photos; add some of those too, tagged `phone`.

### Growing the set from teachers' corrections
`writeEvalCase(dir, name, image, truth, { tags, language })` in `server/services/documents/evalKit.ts` saves a page and its corrected text as a new case. The text comes from `documentText(result, corrections)`. Use it only for pages the owner agreed to share, with names removed. Nothing in the app calls it automatically yet.

Every reading calls the model and costs money: use `--limit` while trying things.
