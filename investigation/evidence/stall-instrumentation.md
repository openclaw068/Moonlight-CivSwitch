# Video-publication stall instrumentation — 2026-11-12

Adds a sub-second record of each video-publication stall so a >50 Mbps 1080p60
incident can be **characterized** after play, instead of being lost between
one-second snapshots. Code + host tests only; no new console run.

## Why

The confirmed >50 Mbps failure mode ([wreckfest-stalls.md](wreckfest-stalls.md),
[quality-80mbps.md](quality-80mbps.md)) is incomplete video frames → repeated
"Waiting for IDR frame" → progressively worsening stalls, with a maximum
publication gap of **2,797.9 ms** in one race. The investigation's own blocker was
diagnostic, stated repeatedly:

> "retained only the last periodic snapshot … not a timeline of the two incidents"
> "without timestamps we cannot place it in the reported stalls"

The per-second history (up to 600 samples) is too coarse to separate the three
plausible causes of a stall. This instrumentation records each stall as a
discrete timestamped event with the counter deltas across it, which **do**
separate them:

- **`delta.decoded > 0` with no publication** → frames decoded but not displayable:
  the waiting-for-IDR / reference-recovery signature (the confirmed wreckfest mode).
- **high `delta.fecWallMs`** → time went into loss recovery: a recovery stall.
- **low `delta.rxBytes`** → little arrived: receive starvation / network.

## What was added

- `telemetry.js` `createStallTracker(thresholdMs, limit)` — pure, cheap. `observe(count, at, capture)`
  is called once per frame with the published-frame counter and a wall time; the
  heavier `capture` thunk runs **only** at stall boundaries. A stall opens when no
  frame publishes for `thresholdMs` and closes on the next publication (or at
  teardown via `finalize`, which keeps a never-recovered stall). Keeps the last
  `limit` events (default 32) and a `summary()` of count/worst/total/ongoing.
- `stream-client.js` — creates the tracker (threshold `max(100, 6000/fps)` ms),
  calls `observe(media.publishedFrames(), Date.now(), capture)` each loop
  iteration while connected, finalizes at teardown, and includes `stallEvents` /
  `stallSummary` in every stats snapshot. The per-frame cost is one scalar read
  plus a compare; `capture` (which reads `frameCounters`, FEC metrics, RX bytes
  and `videoFrames`) runs only when a stall starts or ends — rare.
- `native-media.js` — `publishedFrames()` (scalar, hot path) and `frameCounters()`
  (boundary use).
- `telemetry.js` overlay gains a `Stalls N · worst X ms` line; the RAM history
  records `stallSummary` per second.

Each event:

```
{ startAt, detectedAt, sinceLastPublishMs, durationMs, ended,
  delta: { decoded, presented, superseded, expired, backlog,
           rxBytes, fecCalls, fecWallMs, videoFrames } }
```

This is **observability only** — it changes no stream behaviour, budget, pacing
or recovery path, so it cannot regress playback. It does not by itself reduce
stalls; it makes the next one diagnosable.

## Reading it after an incident

`stallEvents` ride on the stats snapshot, so the existing
`read-stream-diagnostics.js` already exports them in its `MOONLIGHT_SAVED_STREAM_DIAGNOSTICS`
`.stats` payload — no probe change needed. After a stall during play, close the
UI and run the existing diagnostics probe; each `stallEvents` entry's `delta`
classifies that stall by the rules above, and `durationMs`/`startAt` place it in
time.

## Verification

- `tests/test-telemetry.cjs` — `createStallTracker` unit tests: on-time frames
  record nothing and never invoke capture; a threshold-exceeding gap records one
  event with correct `durationMs` and counter deltas and boundary-only captures;
  sub-threshold gaps are ignored; `finalize` keeps a never-recovered stall; the
  ring honours `limit`; `summary()` and the overlay line are correct.
- `tests/test-stream-stall.cjs` — drives the **real** stream loop with real
  telemetry through a simulated stall and asserts the recorded event (duration
  ≥ threshold, `delta.decoded > 0`, exactly one frame to resume) and the overlay
  line.

No console run yet: these establish the mechanism, not a capture of the real
racing incident. The next on-device stall should be read with the probe above.
