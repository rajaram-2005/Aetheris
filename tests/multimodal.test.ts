import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-mm-"));

import { describeContainer, matrixRotation, readContainer, type ContainerInfo } from "../src/core/multimodal/container";
import { coverArtOf, status } from "../src/core/multimodal/perceive";
import { looksLikeJsShell, render, snapshot } from "../src/core/browser/agent";
import { hasVideo } from "../src/lib/router/adapters";
import { orderedCandidates } from "../src/lib/router/router";

// ---- a hand-built ISO base-media file: real box structure, no decoder needed -------------------

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const fourcc = (t: string) => Buffer.from(t.padEnd(4, " ").slice(0, 4), "latin1");
const box = (type: string, ...body: Buffer[]) => { const inner = Buffer.concat(body); return Buffer.concat([u32(inner.length + 8), fourcc(type), inner]); };
const fullBox = (version: number, flags = 0) => { const b = Buffer.alloc(4); b[0] = version; b.writeUIntBE(flags & 0xffffff, 1, 3); return b; };
const IDENTITY = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
const matrix = (m: number[]) => Buffer.concat(m.map(i32));
const EPOCH_1904_TO_1970 = 2_082_844_800;

function videoTrack(codec: string, w: number, h: number, m = IDENTITY) {
  const tkhd = box("tkhd", fullBox(0), u32(0), u32(0), u32(1), u32(0), u32(5000), Buffer.alloc(8), Buffer.alloc(8), matrix(m), u32(w << 16), u32(h << 16));
  const mdhd = box("mdhd", fullBox(0), u32(0), u32(0), u32(1000), u32(5000));
  const hdlr = box("hdlr", fullBox(0), u32(0), fourcc("vide"), Buffer.alloc(12));
  // VisualSampleEntry: 6 reserved + 2 data_ref + 2 pre_defined + 2 reserved + 12 pre_defined, then w/h
  const sample = box(codec, Buffer.alloc(6), u16(1), u16(0), u16(0), Buffer.alloc(12), u16(w), u16(h), Buffer.alloc(20));
  const stsd = box("stsd", fullBox(0), u32(1), sample);
  const stbl = box("stbl", stsd);
  const minf = box("minf", stbl);
  const mdia = box("mdia", mdhd, hdlr, minf);
  return box("trak", tkhd, mdia);
}

function audioTrack(codec: string, channels: number, rate: number) {
  const tkhd = box("tkhd", fullBox(0), u32(0), u32(0), u32(2), u32(0), u32(5000), Buffer.alloc(8), Buffer.alloc(8), matrix(IDENTITY), u32(0), u32(0));
  const mdhd = box("mdhd", fullBox(0), u32(0), u32(0), u32(48000), u32(240000));
  const hdlr = box("hdlr", fullBox(0), u32(0), fourcc("soun"), Buffer.alloc(12));
  // AudioSampleEntry: 6 reserved + 2 data_ref + version(2) revision(2) vendor(4) channels(2) size(2) pre(2) res(2) rate(4)
  const sample = box(codec, Buffer.alloc(6), u16(1), u16(0), u16(0), Buffer.alloc(4), u16(channels), u16(16), u16(0), u16(0), u32(rate << 16));
  const stbl = box("stbl", box("stsd", fullBox(0), u32(1), sample));
  const mdia = box("mdia", mdhd, hdlr, box("minf", stbl));
  return box("trak", tkhd, mdia);
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0xff, 0xd9]);
const coverBox = () => box("data", fullBox(0, 13), u32(0), JPEG);

function mp4(opts: { rotation?: number; cover?: boolean; mvhdVersion?: 0 | 1; created?: number; mdat?: boolean } = {}): Buffer {
  const rotationMatrix = opts.rotation === 90 ? [0, 0x00010000, 0, -0x00010000, 0, 0, 0, 0, 0x40000000] : IDENTITY;
  const mvhd = opts.mvhdVersion === 1
    ? box("mvhd", fullBox(1), Buffer.alloc(8).fill(0), Buffer.alloc(8).fill(0), u32(1000), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(5000n); return b; })())
    : box("mvhd", fullBox(0), u32(opts.created ?? EPOCH_1904_TO_1970 + 1_700_000_000), u32(opts.created ?? EPOCH_1904_TO_1970 + 1_700_000_100), u32(1000), u32(5000));
  const tracks = [videoTrack("avc1", 1280, 720, rotationMatrix), audioTrack("mp4a", 2, 48000)];
  const udta = opts.cover ? box("udta", box("meta", fullBox(0), box("ilst", box("covr", coverBox())))) : Buffer.alloc(0);
  const moov = box("moov", mvhd, ...tracks, udta);
  const ftyp = box("ftyp", fourcc("isom"), u32(0x200), fourcc("isom"), fourcc("iso2"), fourcc("mp41"));
  const mdat = opts.mdat ? box("mdat", Buffer.from("pretend frames")) : Buffer.alloc(0);
  return Buffer.concat([ftyp, moov, mdat]);
}

// --------------------------------------------------------------------------- container reading

test("multimodal: the container reader pulls real facts out of a video file without ffmpeg", () => {
  const info = readContainer(mp4({ mdat: true }));
  assert.equal(info.ok, true, info.reason);
  assert.equal(info.brand, "isom");
  assert.equal(info.durationMs, 5000, "timescale 1000, duration 5000 ticks = 5s");
  assert.equal(info.timescale, 1000);
  assert.equal(info.tracks.length, 2);
  const v = info.tracks.find((t) => t.kind === "video")!;
  assert.equal(v.codec, "avc1");
  assert.equal(v.width, 1280);
  assert.equal(v.height, 720);
  assert.equal(v.handler, "vide");
  assert.equal(v.durationMs, 5000);
  const a = info.tracks.find((t) => t.kind === "audio")!;
  assert.equal(a.codec, "mp4a");
  assert.equal(a.channels, 2);
  assert.equal(a.sampleRate, 48000);
  // 1904 epoch → JS epoch
  assert.equal(info.createdAt, 1_700_000_000 * 1000);
  assert.equal(info.modifiedAt, 1_700_000_100 * 1000);
  assert.equal(info.rotation, undefined, "an identity matrix means no rotation");
});

test("multimodal: rotation and the version-1 movie header are read too", () => {
  const rotated = readContainer(mp4({ rotation: 90 }));
  assert.equal(rotated.rotation, 90, "a portrait phone video says so in its transform matrix");
  const v1 = readContainer(mp4({ mvhdVersion: 1 }));
  assert.equal(v1.ok, true, v1.reason);
  assert.equal(v1.durationMs, 5000);
  // [0 1 0; -1 0 0; 0 0 1] is the matrix a camera writes for a 90° turn: atan2(b, a) = 90
  assert.equal(matrixRotation([0, 0x00010000, 0, -0x00010000, 0, 0, 0, 0, 0x40000000]), 90);
  assert.equal(matrixRotation([-0x00010000, 0, 0, 0, -0x00010000, 0, 0, 0, 0x40000000]), 180);
  assert.equal(matrixRotation([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]), undefined);
});

test("multimodal: embedded cover art is located, sized and typed", () => {
  const buf = mp4({ cover: true });
  const info = readContainer(buf);
  assert.ok(info.coverArt, "cover art should be found in moov/udta/meta/ilst/covr/data");
  assert.equal(info.coverArt!.mime, "image/jpeg", "type indicator 13 = jpeg");
  assert.equal(info.coverArt!.bytes, JPEG.length);
  const art = coverArtOf(buf);
  assert.ok(art, "coverArtOf must find the same payload");
  assert.deepEqual(art, JPEG, "the extracted bytes are exactly the embedded image");
  assert.equal(coverArtOf(mp4({ cover: false })), null);
});

test("multimodal: junk and truncated files are reported, never thrown at", () => {
  assert.equal(readContainer(Buffer.from("not a video at all")).ok, false);
  assert.equal(readContainer(Buffer.alloc(4)).reason, "not enough bytes to be a media file");
  const full = mp4();
  const cut = readContainer(full.subarray(0, 40));
  assert.equal(cut.ok, false, "a truncated file has no moov box");
  assert.match(cut.reason ?? "", /no moov box/);
  // ftyp-only: readable but no metadata → honest failure, not a crash
  assert.equal(readContainer(box("ftyp", fourcc("mp42"), u32(0))).ok, false);
});

test("multimodal: describeContainer states what is known and never implies frames were seen", () => {
  const text = describeContainer(readContainer(mp4({ cover: true })));
  assert.match(text, /container isom/);
  assert.match(text, /duration 5\.00s/);
  assert.match(text, /video avc1 1280×720/);
  assert.match(text, /audio mp4a 48000Hz\/2ch/);
  assert.match(text, /embedded cover art \(image\/jpeg, 18 bytes\)/);
  assert.match(text, /2 track\(s\)/);
  assert.match(describeContainer({ ok: false, tracks: [], reason: "no moov box" }), /could not read/);
});

test("multimodal: video status reports which path is live instead of a blanket no", async () => {
  const st = await status();
  assert.equal(st.video.available, true, "container facts never need ffmpeg");
  assert.ok(st.video.framesVia.startsWith("ffmpeg") || st.video.framesVia.startsWith("provider") || st.video.framesVia === "none — container facts only", st.video.framesVia);
  assert.equal(typeof st.video.ffmpeg, "boolean");
  assert.ok(Array.isArray(st.video.inlineVideoProviders));
});

// --------------------------------------------------------------------------- video routing

test("multimodal: a video in the request narrows routing to providers that take video inline", () => {
  const videoMsg = { role: "user" as const, content: "what happens?", images: ["data:video/mp4;base64,AAAA"] };
  const imageMsg = { role: "user" as const, content: "what is this?", images: ["data:image/png;base64,AAAA"] };
  assert.equal(hasVideo([videoMsg]), true);
  assert.equal(hasVideo([imageMsg]), false);
  assert.equal(hasVideo([{ role: "user", content: "see https://example.com/clip.mp4" } as never]), false, "a bare URL in prose is not an inline video");
  assert.equal(hasVideo([{ role: "user", content: "", images: ["https://cdn.example.com/clip.mov"] }]), true);

  // Routing is driven by what is actually configured, so configure a vision provider that cannot
  // take video (groq) next to one that can (gemini) and measure the difference.
  const saved = { GROQ_API_KEY: process.env.GROQ_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  process.env.GROQ_API_KEY = "test-groq";
  process.env.GEMINI_API_KEY = "test-gemini";
  try {
    const withVideo = orderedCandidates({ vision: true, video: true }).map((p) => p.id);
    const withImage = orderedCandidates({ vision: true }).map((p) => p.id);
    assert.ok(withImage.includes("groq") && withImage.includes("gemini"), `both are vision-capable: ${withImage.join(",")}`);
    assert.ok(withVideo.includes("gemini"), `gemini accepts inline video: ${withVideo.join(",")}`);
    assert.ok(!withVideo.includes("groq"), "groq is vision-only — a video must not be routed to it");
    assert.ok(withImage.length > withVideo.length, `video narrows the field (${withVideo.join(",")} vs ${withImage.join(",")})`);
    assert.ok(withVideo.every((id) => withImage.includes(id)));
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// --------------------------------------------------------------------------- browser shell detection

test("browser: a JavaScript application shell is detected instead of being described as content", () => {
  const shell = `<html><head><title>App</title></head><body><div id="root"></div><script src="/static/js/main.9f2c.js"></script></body></html>`;
  const s = snapshot("https://example.com/", shell, 200);
  assert.equal(s.needsJs, true, "root div + bundle + no text = client-rendered");
  assert.match(render(s), /JavaScript application shell/);

  const ssr = `<html><head><title>Docs</title></head><body><div id="root"><h1>Install</h1><p>${"Run npm install aetheris and then start the server. ".repeat(12)}</p><a href="/next">Next</a></div><script src="/static/js/main.js"></script></body></html>`;
  const r = snapshot("https://example.com/docs", ssr, 200);
  assert.equal(r.needsJs, undefined, "a server-rendered page with real text is not flagged");
  assert.equal(r.links.length, 1);
  assert.ok(!render(r).includes("JavaScript application shell"));

  // Plain static pages are never flagged, even when thin.
  const thin = `<html><body><p>Hello</p></body></html>`;
  assert.equal(snapshot("https://example.com/t", thin, 200).needsJs, undefined);
  assert.equal(looksLikeJsShell(shell, ""), true);
  assert.equal(looksLikeJsShell(thin, "Hello"), false);
});
