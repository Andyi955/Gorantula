# Scientific Research — test papers

Real arXiv paper metadata (title, authors, year, abstract) for testing the
Scientific Research engine locally. No live web fetching is needed; the engine
extracts claims from the abstract text.

## Ingest them (backend must be running on `:8080`)

```powershell
powershell -File .\testdata\papers\ingest.ps1
```

Then open the app (`http://127.0.0.1:5173/` → Enter the Vault → **Research**) and
check **Findings** / **Corpus**.

## Paper JSON shape

```json
{
  "id": "arxiv-1706.03762",
  "title": "Attention Is All You Need",
  "authors": ["Ashish Vaswani", "Noam Shazeer"],
  "venue": "arXiv",
  "year": 2017,
  "abstract": "…",
  "sourceURL": "https://arxiv.org/abs/1706.03762",
  "license": "arXiv"
}
```

Drop any number of these JSON files in this folder, then re-run `ingest.ps1`.

## Notes

- The bundled real papers (`Attention Is All You Need`, `BERT`) are for claim
  extraction / corpus testing — they don't contradict each other.
- `test-contradiction-a.json` + `test-contradiction-b.json` is a **synthetic**
  pair (same drug, opposite reported direction) that reliably triggers a
  **Contradiction** signal — ideal for testing that path. Marked `synthetic-test`.
- To exercise a real-world contradiction, ingest two papers that genuinely
  disagree on a shared entity (same drug / target / product, opposite reported
  direction). The engine surfaces a **Contradiction** under Findings for those.
