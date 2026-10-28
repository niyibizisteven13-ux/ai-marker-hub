# Marking validation

Run `npx tsx scripts/eval-marking.ts comparisons.json` with anonymised teacher comparisons:

```json
[{"paperId":"sample-001","questionId":"1","category":"handwriting","maxMarks":5,"teacherMarks":3,"aiMarks":3,"flagged":false}]
```

Use categories handwriting, maths, diagram, poor_scan and printed. Record null AI marks as abstentions, not zero. Use independently teacher-marked scripts, include difficult scans, and keep calibration examples separate from held-out evaluation. Review exact agreement, mean absolute error, coverage and unflagged errors by category before release. This tool measures supplied marks; it does not itself establish handwriting accuracy.

## Live workflow verification

On a physical phone and laptop: scan several students, confirm the scheme, verify that the first student's marks appear before the batch completes, pan/pinch the image, correct a reading, adjust and approve a question, review the paper, then compare exported PDF positions with the preview. During marking disconnect/reconnect and refresh; saved questions must remain. Interrupt a provider attempt and verify that same-run validated checkpoints are skipped, while a new explicit re-mark re-evaluates answers. Check owner isolation for streams, paper images and approvals.

Progress counts persisted question proposals, not tokens or estimated reasoning. Recognition still reads a student's pages to preserve cross-page answers. Marking uses bounded candidate concurrency, one-question calls and focused answer context including unassigned evidence. AI memory consists of saved documents, versioned schemes, results and audit history; it is not unlimited model context. Throughput depends on scan size and provider latency/rate limits.
