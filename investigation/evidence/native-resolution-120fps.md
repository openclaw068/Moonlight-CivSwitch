# Native resolution and 120 fps feasibility — 2026-11-12

Analysis of what it would take to run this client at the Switch 2's native
resolution and 120 fps, and where the realistic ceiling is. This is a
**code/architecture analysis plus off-device-verified changes**; nothing here
was measured on a console. On-device confirmation of the present-cadence gate
(below) is still required.

## Summary

- **"Native resolution" is effectively 1080p, and the app already targets it.**
  The Switch 2 handheld panel is 1920×1080. A Switch 1 back-compat title (Civ VII,
  the host of this client) is capped at 1080p even docked, and the whole decode/
  texture path here is hard-capped at 1920×1080 (see cap map). So native
  resolution is a *stabilization* goal, not a new capability.
- **True 1080p120 is not reachable in this architecture.** Three independent
  walls each block it on their own. The valuable, achievable target is
  **rock-solid 1080p60**.

## The three walls to 120 fps

1. **Present/display ceiling (platform, not fixable in this repo).** Video is
   published to Civ VII's Coherent Gameface engine on `requestAnimationFrame`
   (`app/src/streaming/stream-client.js`, `createClock`), so the achievable frame
   rate cannot exceed the engine's present cadence. Civ VII is a Switch 1 title;
   under back-compat (including firmware 22.0.0 "Handheld Mode Boost") it presents
   at 60 Hz, and the 120 Hz panel is not exposed to back-compat Switch 1 titles.
   The code already assumes this: the smoothing pacer is only created at
   `fps===60` (`native-media.js`, `videoSetup`), and Settings stop at 60.
   *This wall is now measurable — see [present-cadence.md](present-cadence.md).*
2. **Codec.** The movie decoder Civ VII exposes accepts only H.264/VP8/VP9 and
   rejects HEVC ([hevc.md](hevc.md)); there is no AV1 path. H.264 needs the most
   bits per frame, the worst case for doubling the frame rate.
3. **Execution model.** The Moonlight core is wasm2js (plain JS) in V8
   `9.4.146.24` with `jitless=1`, WebAssembly disabled and no worker threads
   ([streaming-feasibility.md](streaming-feasibility.md)). It is a single-threaded
   cooperative loop that already needs a 12 ms budget and drops some audio to hold
   1080p60 ([quality-1080p.md](quality-1080p.md)). Halving the per-frame budget for
   120 fps is an order-of-magnitude gap, not a tuning gap.

Community signal matches: upstream issue #3 requests 120 fps with no technical
path offered, and issue #5 shows the GPU present path is still fragile.

## Hard caps in code (where 1080p/60 live)

| Limit | Location |
| --- | --- |
| Resolutions 360p–1080p; frame rates 15/30/60 | `app/src/storage/stream-settings.js` |
| H.264 renderer dims `w>1920 || h>1080` rejected (GPU) | `app/src/streaming/native-media.js` `videoSetup` |
| Smoothing pacer only at `fps===60` | `app/src/streaming/native-media.js` `videoSetup` |
| Native texture dims `>1920×1080` rejected (GPU) | `app/src/streaming/native-texture.js` `create` |
| Launch/core start passes `mode.fps` as a request only | `app/src/streaming/stream-client.js` (`_ml_session_start`) |

Raising any single cap produces a configuration that cannot present (walls 1–3),
so none were raised. The effort is directed at 1080p60 stability instead.

## Changes made in this pass (off-device verified)

1. **GPU-sync fallback for 1080p60 robustness.** The async GPU fence/pipeline
   setup now degrades to synchronous GPU presentation instead of failing the
   whole stream when the fence ABI does not match a given unit/firmware (upstream
   issue #5). See [issue-5-gpu-sync.md](issue-5-gpu-sync.md). Verified by
   `tests/test-media-queues.cjs`.
2. **Present-cadence telemetry (Phase-0 gate).** The clock now measures the
   interval between animation-frame wakes, surfaced as `presentHz` in the overlay.
   One device session with this build answers definitively whether any present
   cadence above 60 Hz is reachable. See [present-cadence.md](present-cadence.md).
   Verified by `tests/test-telemetry.cjs`.

## Recommended direction

Treat 1080p60 as the target: land the robustness/stability work (fallback above,
plus continued >50 Mbps stutter and audio-drop tuning). Treat 120 fps as gated on
the present-cadence probe; if it reads a steady 60 Hz (expected), the ceiling is
confirmed and 120 fps stops being a client-side question. The higher-value
quality win within 60 Hz is a future HEVC/AV1 decoder hunt (a lower-level decoder
interface was explicitly **not** ruled out in [hevc.md](hevc.md)).
