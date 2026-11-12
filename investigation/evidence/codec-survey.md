# HEVC/AV1 decoder hunt — 2026-11-12

Follow-up to the [HEVC investigation](hevc.md), widening the search from the
app's `movie::Decoder` enum to **every loaded module** on the Switch 2 Civ VII
process and to **AV1 and lower-level NVDEC/NVMEDIA decode interfaces**. The goal
was to find any route to a hardware HEVC or AV1 decoder, since both would raise
streaming quality per bit well above H.264.

This note has two parts: a **negative finding from already-captured on-console
inventories** (strong but, being regex-filtered point-in-time scans, not
absolute), and a **turnkey probe** that makes the result airtight when a console
is available. No console run was performed for this note.

## Finding from captured data: no HEVC/AV1 decoder is present

The earlier module and export captures
([streaming-modules.txt](streaming-modules.txt),
[hevc-codec-inventory-switch.txt](hevc-codec-inventory-switch.txt),
[oled-decoder-exports.txt](oled-decoder-exports.txt)) enumerate seven executable
modules. Their complete video/codec decode surface is:

| Module | Role | Video decode surface |
| --- | --- | --- |
| `main` (34,774 sym) | Civ VII + V8 | none — the "decoder" symbols are V8's **WASM** `WasmFullDecoder`/`ModuleDecoderImpl`, not video |
| `sdk` (23,046 sym) | nnSdk | audio only (`FDK_sbrDecoder`, AAC SBR); no video decoder exports matched |
| `other@…8548000` (4,241 sym) | **`movie`** | `movie::Decoder` (enum types 1–5) + `CreateH264 / Vp8 / Vp9 / AacDecoderConfigurationData`. **No HEVC, no AV1** creator or enum entry |
| `other@…4365000` (2,044 sym) | **cohtml (Gameface) media** | **libvpx** (`vpx_codec_*`, VP8/VP9 software) + `cohtml::media::MediaDecoders`/MP4Parser. No HEVC/AV1 library (no libde265, dav1d, libaom) |
| `other@…800000` (3), `…850d000` (74), `…8518000` (914) | unidentified | no codec/media symbols matched |

Corroborating details:

- The `movie` module's config-data creators are internally complete for
  H264/VP8/VP9/AAC with **no sibling `CreateHevc…` or `CreateAv1…`**. The decoder
  enum table (`[0,4,1,65,66]`, types 1–5) is H.264/VP8/VP9/AAC/Vorbis, and all
  HEVC MIME strings returned `-1` ([hevc.md](hevc.md)).
- The 38 "HEVC" string hits across captures are almost entirely the **Sunshine
  host** advertising its own encode capability (`MaxLumaPixelsHEVC`,
  `ServerCodecModeSupport` in `/serverinfo`) — a server property, not a Switch
  decoder.
- **AV1, aom, dav1d, libgav1, de265, NVDEC, NVMEDIA, NVJPG, Tegra, VIC, OMX,
  MediaCodec: absent from every capture.**

### Why the silicon's capability does not help here

The Switch 2's T239 very likely has a hardware NVDEC that can decode HEVC and
AV1. But this client reaches decoding **only** through Civ VII's `movie` library,
which does not expose those codecs. Direct NVDEC access would need the `nvdrv`
service; a prior probe that requested the literal `nvdrv` name **blocked and
required restarting the game** ([streaming-feasibility.md](streaming-feasibility.md)),
and `nvdrv` exposes no C++ symbols to search (it is an IPC/ioctl service). So the
hardware ceiling is not the practical ceiling: there is no evidenced, safe route
to it from this execution context.

### Honest limits of the negative

- The per-module exports were captured through a **media regex filter**, not a
  full unfiltered name dump, so a differently-named decoder could in principle
  have been missed (though `VideoDecoder`/`MediaDecoder`/`Create…Decoder…` would
  have matched an HEVC entry, and none appeared).
- Modules load **lazily** — the `movie` module itself is present on Switch 2 and
  absent on Switch OLED ([oled-compatibility.md](oled-compatibility.md)) — so a
  point-in-time scan cannot prove an HEVC module is never mapped later. There is
  no evidence one exists, and Civ VII has no reason to ship one.

The probe below closes both gaps.

## Turnkey probe: `inspect-codec-survey.js`

`investigation/probes/inspect-codec-survey.js` walks every loaded RX module and,
for each, scans **both** the dynamic symbol names **and** the raw string-table
blob for the full codec token set — `hevc`, `h265`, `hvc1`, `hev1`, `av1`,
`av01`, `aom`, `dav1d`, `de265`, `libgav1`, `nvdec`, `nvmedia`, `nvjpg`, `tegra`,
`vic`, `omx`, `mediacodec` — alongside the known `avc`/`vp8`/`vp9` markers so a
run self-confirms it is reading real codec data. It also lists small modules'
symbol names in full so the 74- and 914-symbol modules are positively identified.
It is read-only: no decoder is created, no media submitted, no memory written,
and all scratch is freed. It does **not** open `nvdrv` or any service.

Run from the repository root with CivSwitch waiting and the Moonlight UI closed:

```sh
python3 -B investigation/probes/send-probe.py <SWITCH_IP> \
  investigation/probes/native-probe-helpers.js \
  investigation/probes/inspect-codec-survey.js \
  --output investigation/evidence/codec-survey-switch.txt
```

Read `MOONLIGHT_CODEC_SURVEY_STRINGS[...].leads` and
`MOONLIGHT_CODEC_SURVEY_NAME_MATCHES`. Expected outcome (confirming the finding):
every module's `leads` is empty and the only name matches are the
H.264/VP8/VP9/libvpx symbols. **Any** non-empty `leads` entry or an unexpected
`VideoDecoder`/`nvdec`/`nvmedia` symbol is a real HEVC/AV1 lead to pursue.

Logic verified off-device by `tests/test-codec-survey.cjs` (clean module →
no leads; planted `video/hevc`/`av01`/`x-h265` + `VideoDecoder`/`nvdec` → flagged;
small modules listed in full). Mock tests are not hardware evidence.

## Recommendation

On the captured evidence, **HEVC/AV1 is a dead end for this client** and H.264
should remain the stream codec. Run `inspect-codec-survey.js` once on a console to
convert this from "strongly evidenced" to "confirmed"; absent a positive lead, do
not invest in codec negotiation changes. The remaining quality lever at 1080p60 is
H.264 bitrate/pacing tuning, not a codec change.
