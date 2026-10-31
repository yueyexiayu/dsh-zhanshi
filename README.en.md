<div align="center">
<img src="docs/repo-assets/hero.svg" width="100%" alt="Original current-turn media, official-card deduplication and preview concept; not an application screenshot" />
<h1>zhanshi · See this turn's outputs</h1>
<p><strong>Show saved images/videos at the turn tail without duplicating official deliverable cards.</strong></p>
<p><a href="README.md">简体中文</a> · <strong>English</strong></p>
<p><a href="package.json">v0.1.4</a> · <a href="LICENSE">MIT</a> · DSH desktop plugin</p>
<p><a href="#features">Features</a> · <a href="#how-it-works">How it works</a> · <a href="#installation">Installation</a> · <a href="#collection-rules">Collection</a> · <a href="#file-boundaries">File boundaries</a> · <a href="#validation">Validation</a></p>
</div>

---

Display successful current-turn media that lacks an official same-path card. No model-context insertion, generation or replacement of the official renderer. **Reading an old image does not produce a new output.**

## Features

<table><tr>
<td width="33%"><strong>🖼 Turn-tail previews</strong><br/><br/>Open images and play videos with native controls. Render nothing when no media exists.</td>
<td width="33%"><strong>🧭 Ownership and deduplication</strong><br/><br/>Use successful results, cwd and sequence numbers; official same-path deliverables take priority.</td>
<td width="33%"><strong>📁 Bounded reads</strong><br/><br/>Demand-driven64KiB video windows; over64MiB becomes open-file UI, without deleting media.</td>
</tr><tr>
<td><strong>🔤 Actual paths</strong><br/><br/>Prefer structured generation results, preserving spaces, quotes and Unicode rather than guessing damaged text.</td>
<td><strong>🛡 Official file services</strong><br/><br/>Use DSH authentication, policy and bounded readers; missing capabilities fail without unrestricted reads.</td>
<td><strong>🧾 Visible failures</strong><br/><br/>Keep failed cards, retry and paths; pending background work or cancellation is never a completed output.</td>
</tr></table>

## How it works

![Successful turn results pass ownership, official-card deduplication and media filters before showing a preview or open-file entry.](docs/repo-assets/workflow.en.svg)

Registered as `zhanshi` in `conversation.chat.turnTail`, beside official delivery cards, not hidden inside tool calls. Historical turns reconstruct previews from events after restart.

## Installation

Clone/copy into `$DSH_HOME/plugins/zhanshi`. Add this item **inside the existing insert list** in `$DSH_HOME/profiles/desktop/cordis.patch.yml`, retaining other entries:

```yaml
- id: zhanshi
  name: ../../plugins/zhanshi/lib/index.js
```

Fully quit DSH with ⌘Q and reopen; refreshing the page does not reload the Host. Uninstall only this entry before another full restart. Host needs connection/fs, Client needs slots/uiConversation; official DSH source stays unchanged.

## Collection rules

- Accept explicit successful present/write/edit and supported generation/screenshot results without structured errors. read_image means viewing old files, never production.
- Normalize paths against session cwd. Official deliverables.presented suppress the same path only before the current closing sequence, not unmaterialized present operations, independent generated media or same filenames in other directories. Official produced records remain valid sources.
- Prefer shengcheng_result structured paths, preserving Unicode/quotes/spaces. Damaged structured data fails instead of guessing. Independent legacy `saved …` lines remain supported.
- Nonzero, timed-out, killed, cancelled or still-background bash work is not finished. Only explicit save lines/reliably identified targets qualify, not a compound command's incidental last old file or examples in logs.
- Same-path newest sequence refreshes the URL; different directories remain distinct. Show at most16 items, prioritizing explicit final deliverables then newer media, with a visible overflow count. Official records are not deleted.
- Keep only necessary call fields and release call state after processing; lightweight path metadata supports deduplication/counting. Failed images/videos retain visible cards with retry/open; videos preload metadata only.
- Filter node_modules, .git, parent traversal, globs and unsupported extensions. These are product filters, not substitutes for official file permissions.

## File boundaries

<details>
<summary><strong>Authentication, ranges, versions and large files</strong></summary>

Images use relative `/api/file`; video uses `/api/zhanshi/file`, including dsh-app:// support. DSH connection handles authentication. Video goes through composed ctx.fs resolve/processPath/stat/readByteRange. Missing bounded APIs return501; no bare Node fs or full-file snapshot fallback, and no decoding opaque target keys.

GET/Range reads demand-driven windows up to64KiB. The first window is read before headers, later windows honor backpressure. Unsatisfiable single ranges return416; malformed/multiple ranges fall back to full-file semantics. ETag is SHA-256 of the official version token, **not a content hash**. Only a matching strong If-Range accepts partial output; stale/weak/date values fall back. HEAD ignores Range and reads metadata only.

Each window checks version/size before and after reading. Short reads, growth or replacement fail with409/404 before headers or a body-stream error afterward, rather than mixing file versions. This is not a descriptor-held immutable snapshot or malicious-process race guarantee. Request/consumer cancellation interrupts provider I/O and releases listeners/windows; permission, missing-file, size and I/O errors stay visible.

**64MiB is a preview limit, not a generation limit.** shengcheng may save256MiB video. Larger previews return413 with X-Zhanshi-Preview:open-file and X-Zhanshi-File-Size. Client HEAD detects this and displays actual size/open-file without raising memory limits or deleting media. Permission/404/500 HEAD failures remain retryable. External opening requires Host openFile; absent capability retains a path/link, not a claim that an app opened. Bounded windows still have provider/concurrency overhead, not zero-copy guarantees.

</details>

## Validation

A complete read-only extracted official installation is required. Missing DSH_OFFICIAL_ROOT/packages fails without skip/old-checkout fallback. Fixtures write only random temporary media and import official source read-only.

```bash
export DSH_OFFICIAL_ROOT=/absolute/path/to/extracted-official-runtime
for file in lib/*.js; do /usr/local/bin/node --check "$file" || exit; done
/usr/local/bin/node --test
```

<details>
<summary><strong>Historical checks—not current desktop acceptance</strong></summary>

2026-10-12:143/143 regressions covered real Client reducers/gallery/HEAD behavior, old-read exclusion, official-card deduplication,256MiB open-file fallback, errors and disposal. Official filesystem fixtures checked read-only ranges, replacement/If-Range and large HEAD responses; controlled providers covered backpressure, cancellation, file changes and errors.

An isolated Chrome/React18.3.1 smoke test covered synthetic requests and actual source, not a reloaded desktop. scripts/browser-smoke.mjs requires explicit existing DSH_PLAYWRIGHT_MODULE, DSH_REACT_UMD, DSH_REACT_DOM_UMD and DSH_BROWSER_EXECUTABLE; missing values fail without installing dependencies. Earlier0.1.3 records report136/136 tests and five official-reader file checks. Detailed records remain in the [Chinese README](README.md).

</details>

**This update checks bilingual documentation, diagrams, links and layout only. Product tests were not rerun, no paid media was generated and DSH was not restarted.** Historical component/browser fixtures are not current desktop acceptance.

[MIT License](LICENSE).

<div align="center"><sub>Show real outputs. Keep failures visible. · <a href="README.md">阅读中文版 →</a></sub></div>
