# Legal assistant guide

## Record and evidence contract

A law record contains a stable ID, jurisdiction, BCP-47-style language tag, title, official URL, retrieval timestamp, normalized text, edition/status, effective-date interval when known, translation flag and SHA-256 hashes. Normalization uses NFC and LF and trims the outer whitespace. Each section stores exact UTF-16 string offsets and UTF-8 byte offsets into normalized text. These are not offsets into the original HTML/PDF. `rawHash` identifies the original downloaded bytes separately.

`normalizeLaw`, `queryLaws`, `answerQuestion`, `formalizeLaw`, `encodeKnowledge`, `decodeKnowledge`, `buildCoverage` and `evaluateRules` are public library exports. Import collection/persistence from `@link-assistant/legal/collector`; import HTTP helpers from `@link-assistant/legal/server`.

`answerQuestion` ranks lexical overlap and returns whole source sections. It uses Unicode words and Han bigrams without machine translation. Different inflections, synonyms, cross-language questions and unstated facts can miss relevant laws. A positive match establishes only that matching text was collected. An empty result is not a statement about the law.

An `asOf` filter excludes unknown-date records. Collection time is not legal effect. End dates are exclusive. The sample deliberately makes no inferred effective-date claims.

## Formalization and rules

`formalizeLaw` builds real `meta-language` lossless text networks, verifies reconstruction, records exact source spans and classifies surface modal cues. `links-notation` parses interchange syntax and `lino-objects-codec` encodes/decodes structures. Modal cues are tagged `verified:false`; syntactic losslessness does not prove legal equivalence.

`evaluateRules(laws, rules, facts, context)` evaluates explicitly reviewed source-bound rules. A rule records `reviewedBy`, law ID/hash, exact quotation/offsets, jurisdiction, effective dates, fact conjunctions in `when` and `unless`, and a boolean predicate conclusion. Unknown facts remain unknown; an established exception prevents application; competing true/false conclusions return conflict. Context requires jurisdiction, `asOf`, and predicate. A source change invalidates stale rule hashes. No priority or legal interpretation is invented. Tests use plainly labeled synthetic rules; no unreviewed sample law rule is represented as authoritative.

The Formal AI source pin and SHA-256 are in `scripts/bootstrap-formal-ai.mjs`; `patches/formal-ai/legal-context.patch` adds categorical evidence assessment. Installation materializes the pinned upstream code in ignored `src/generated/`. Git stores the patch, not a full dependency copy. Published npm tarballs include the built runtime module. Offline source builds can call the bootstrap script with a locally cached exact upstream source file. `prepare`, `pretest` and `prepack` verify/build the module as needed. Fresh Deno checkouts must run `deno run -A scripts/bootstrap-formal-ai.mjs` before `deno test -A --parallel`; the CI matrix does this explicitly. Patch files accept LF or CRLF checkout endings while upstream checksums and source context remain exact. Other associative packages are exact npm dependencies, not vendored code.

## Collect and update

```sh
node bin/legal-assistant.js sources
node bin/legal-assistant.js discover us-code --pages 1 --output /tmp/us-laws.json
node bin/legal-assistant.js collect --manifest /tmp/us-laws.json --store collections/us --limit 10
node bin/legal-assistant.js export --store collections/us --output /tmp/us-corpus.json
node bin/legal-assistant.js ask "definitions" --corpus /tmp/us-corpus.json
```

Discovery manifests use `schemaVersion:1` and `entries`, each with `id`, `sourceId`, `url`, `title` and `language`. Explicit `format`, `encoding` and `contentSelector` can adapt a known official resource. `data/sources.sample.json` lists actual temporary collection sources; collection downloads whole resources, while the committed demo intentionally uses bounded excerpts.

Resume a bounded discovery with `legal-assistant discover SOURCE_ID --resume previous-manifest.json --output next-manifest.json`. Scheduled runs persist the same directory cursor automatically. GovInfo traversal retains failed paths and extracts each CFR XML section, plus a separate context record preserving authorities and appendices. The bounded [GovInfo discovery example](../examples/discover-govinfo.mjs) exercises the live directory without starting a complete crawl.

Discovery is bounded and returns errors, unresolved resources, `nextPage`, `nextUrl` and `complete:false`. `catalog-exhausted` describes only one publisher catalog in that request, never global legal coverage. Current adapters include USLM ZIPs, GovInfo recursive directories with persisted cursors, Cellar SPARQL results, India Code act/section links, Matsne translations, and provisional NPC/Pravo list schemas. NPC's POST listing and `rows`/`bbbs` response contract are implemented, but its observed robots policy prohibits automated collection. The collector stops before listing; use a permitted alternative or obtain publisher permission. Metadata without verified full-text links remains unresolved. NPC detail resolution, scanned PDFs/OCR, regional publishers, and national Europe inventories remain unfinished. See the case study for exact blocked criteria; do not treat registry entries as completed collectors.

Downloads enforce source origins, redirect limits, robots rules on every redirect target, per-origin spacing of at least 1.5 seconds (or the stricter configured/published `Crawl-delay`), finite streaming byte budgets, retry/backoff and conditional ETag/Last-Modified requests. Validators are sent only to the final URL that supplied the cached body; a changed redirect target is downloaded even if it uses the same ETag. An unsolicited 304, including a POST response, fails rather than reusing unrelated evidence. HTML responses in place of robots.txt fail closed. A published crawl delay over the bounded 60-second wait budget stops collection rather than shortening the delay. Transport logs are off unless `--debug` is set. XML rejects entity declarations. ZIPs limit uncompressed content; PDFs bound page and text counts and reject image-only output. HTML must match an explicit law-body selector. India Code act metadata must expand to section APIs/PDFs; it cannot silently become law text.

Stores separate immutable raw evidence, HTTP metadata, version histories, current records and run reports. Writes use atomic rename. A failed run preserves existing records. A collection lock prevents competing writers; after an interrupted process, inspect/remove `.collection-lock` in the chosen store before resuming. Discovery errors never delete data. Full legal amendments, repeals and consolidation are not inferred from disappearance or text differences.

```sh
node scripts/update-collection.mjs examples/collection/config.json
```

The scheduled runner checkpoints pending records and pagination between bounded runs; failures remain pending. `intervalDays` defaults to seven after a catalog cycle completes. `pagesPerRun` and `documentsPerRun` bound load. The [separate-repository workflow template](../examples/collection/weekly.yml) runs weekly and preserves checkpoints and artifacts, making partial runs visibly fail. Change its cron and configuration for another cadence. It does not publish a permanent corpus here. Publisher-specific redistribution review and permanent repository deployment remain outstanding; `redistributionReviewed:false` explicitly records that status. Run only one scheduled writer per store.

## HTTP and Docker

The [OpenAPI document](openapi.json) describes:

| Method | Path                                      | Behavior                                              |
| ------ | ----------------------------------------- | ----------------------------------------------------- |
| GET    | `/health`                                 | Health and record count                               |
| GET    | `/v1/sources`, `/v1/coverage`             | Publisher inventory and explicit gaps                 |
| GET    | `/v1/laws`                                | Paginated metadata with jurisdiction/language filters |
| GET    | `/v1/laws/{id}`                           | Full normalized law and provenance                    |
| GET    | `/v1/laws/{id}/formalization?format=lino` | Lossless networks; JSON is default                    |
| GET    | `/v1/search?q=...`                        | Exact cited lexical matches                           |
| POST   | `/v1/answer`                              | Same engine as CLI/browser                            |
| GET    | `/openapi.json`                           | API description                                       |

A law ID shared by multiple language editions requires `?language=TAG` on detail/formalization requests (otherwise HTTP 409), or `--language TAG` with CLI `formalize`. Unknown editions return 404 over HTTP.

JSON bodies have a 16 KiB limit. Queries allow 1–4,000 characters and 1–100 results; law listings allow up to 100 records per page. HTTP formalization limits each input to 100,000 characters; split longer records or use the library. The server is read-only, defaults to localhost, and enables CORS only for explicitly configured allowed origins. Set `LEGAL_CORPUS` or `--corpus` to use another validated corpus.

The Docker image runs Node 24 as non-root and exposes port 8787. It includes sample data, a health check, and the same API/CLI. Build and run commands are in the README. This workspace could build the image but its cgroup configuration prevented launching a container; CI runs the actual health and answer smoke test on a hosted runner.

## Browser and verification

`npm run build:demo` bundles the engine and actual collected corpus into `dist/legal-demo`. There are no remote question/LLM calls, CDN fonts or runtime package downloads. The browser can import another collected JSON corpus, with schema, size and content-hash checks. Formalization downloads run locally. The existing Pages pipeline packages the explorer under `legal/` beside the original universal app. Pages is configured for GitHub Actions. It deploys on main pushes or an explicit `Example app` workflow dispatch with `deploy_pages:true`; branch deployment does not regenerate or commit main-branch preview images.

`npm test` runs all unit/integration tests. `npm run test:legal` focuses on collection, provenance, round trips, multilingual matching, rules, scheduling, CLI and API. `npm run test:browser` starts a local static server, verifies Chromium search and citations, tests a phone viewport, and captures the committed screenshot. `npm run check` covers repository lint/format/duplication policies. Tests use bounded fixtures and local mocks; live government availability is recorded as separate research evidence.
