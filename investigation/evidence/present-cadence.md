# Present-cadence instrumentation (Phase-0 120 fps gate) — 2026-11-12

Adds a measurement that answers the single question gating the entire 120 fps
track: **at what rate does the host engine actually present?** Code + host tests
only; the on-device reading has not been captured yet.

## What is measured

The stream loop waits on `requestAnimationFrame` through the clock in
`app/src/streaming/stream-client.js` (`createClock`). The clock now records the
interval between consecutive animation-frame ("frame") wakes:

- `frameIntervalCount`, `frameIntervalMs`, `frameIntervalSqMs` (cumulative, for
  per-second mean and jitter)
- `minFrameIntervalMs`, `maxFrameIntervalMs` (session extremes)

`telemetry.js` derives per second, from `snapshot.clock`:

- `presentIntervalMs`, `presentJitterMs`
- `presentHz` = `1000 / presentIntervalMs`
- `minPresentIntervalMs`, `maxPresentIntervalMs`

The performance overlay shows a new line:

```
Present cadence 60.0 Hz (16.7 ± 0.3 ms · min 16.6)
```

Only genuine rAF wakes feed this; the 50 ms watchdog timer and forced stop wakes
are excluded, so the number is the engine's real present opportunity rate, not
the client's loop rate (`loopHz` remains separate).

## How to read it (the gate)

- **`presentHz` ≈ 60 and `minPresentIntervalMs` ≈ 16.6** → the engine presents at
  60 Hz. This confirms the back-compat 60 Hz present ceiling, and 120 fps is not
  reachable from the client regardless of decode throughput. (Expected outcome.)
- **A sustained `presentHz` above 60, or `minPresentIntervalMs` ≈ 8.3** → the
  engine can present faster than 60 Hz under some mode (e.g. Handheld Mode Boost).
  Only this result would justify any further 120 fps decode-throughput work.

`presentHz` reflects present opportunities, not decoded/published frames; compare
it against `decodedFps`/`textureFps`, which remain capped by decode and the
60-fps pacer. It is not a display-scanout measurement.

## On-device procedure (when a console is available)

1. Pair and start any stream at 1080p60 with the performance overlay on.
2. Read the **Present cadence** line in handheld, in handheld with Handheld Mode
   Boost enabled, and docked. Record `presentHz`, `presentIntervalMs ± jitter`,
   and `minPresentIntervalMs` for each.
3. If every configuration reads ~60 Hz, record this as confirmation of the
   present ceiling in [native-resolution-120fps.md](native-resolution-120fps.md)
   and close the 120 fps track. If any reads materially above 60 Hz, open a
   follow-up on decode throughput.

## Verification status

- Host test `tests/test-telemetry.cjs` covers the per-second derivation, the
  no-new-frames case (no stale reading), and the overlay line format.
- No console reading captured yet; all values above are illustrative.
