# GPU-sync fallback for the async present path — 2026-11-12

Code-only change to improve 1080p60 robustness. **Not yet verified on a console**;
covered by host unit tests. Addresses the class of failure reported upstream as
issue #5 ("GPU sync pointer range rejected" / instant disconnect on some
Switch 2 units).

## The failure

The asynchronous GPU presentation path builds a completion fence by resolving a
pointer chain at build-specific offsets inside the movie module and checking an
ABI signature (`createGpuFence` in `app/src/streaming/native-media.js`). On
consoles whose Civ VII build or firmware exposes a different layout, that resolve
or signature check throws (`GPU sync pointer range rejected` / `Unsupported GPU
sync ABI`). Previously this exception propagated out of `videoSetup`, so the
entire stream failed to start. The community workaround was a hand-patched build
forcing `synchronousGpu:true`.

## The change

The async-GPU setup (smoothing pacer, fence, transfer pipeline) is now built
through a small injectable helper, `buildAsyncGpu(makePacer, makeFence,
makePipeline)`:

- On success it returns `{videoPacer, gpuFence, gpuPipeline}`.
- On failure it releases any partially built object (pacer/fence) and returns
  `{error}`.

`videoSetup` then falls back to the **synchronous GPU path** on `{error}`:
`videoPacer`/`gpuFence`/`gpuPipeline` stay `null`, which is exactly the existing
`synchronousGpu` presentation route — every drained decoder output is copied and
published inline, with no completion fence. The stream runs (slightly less
optimally) instead of disconnecting; no hand-patched build is needed.

The fallback is observable: `stats.renderer` reports `native-gpu-texture-sync`
and `stats.gpuSyncFallback` carries the triggering error message.

## Scope and limits

- This does not *fix* the fence ABI on affected units; it makes the client
  survive the mismatch. Identifying the correct per-build offsets so the async
  (lower-latency, smoothed) path works everywhere is a separate on-device task.
- The synchronous path has no one-spare-frame smoothing, so paced 60 fps behaviour
  on a fallback unit may be less even than on a unit using the async path. That is
  a deliberate trade against a hard disconnect.
- Verified only by `tests/test-media-queues.cjs` (`buildAsyncGpu` returns objects
  on success; returns `{error}` and closes the pacer on fence rejection; closes
  the fence when pipeline wiring fails; tolerates a null pacer). Real console
  behaviour on an affected unit is unverified here.
