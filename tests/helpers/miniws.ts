/** Minimal RFC6455 text-frame WebSocket server for tests (no deps). */
import { createHash } from "node:crypto";
import http from "node:http";
import type { Socket } from "node:net";
export function miniWsServer(onMessage: (msg: Record<string, unknown>, send: (m: unknown) => void) => void): Promise<{ url: string; close(): void }> {
  const srv = http.createServer((_q, r) => { r.writeHead(426); r.end(); });
  srv.on("upgrade", (req, sock: Socket) => {
    const key = req.headers["sec-websocket-key"] as string; const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (m: unknown) => { const p = Buffer.from(JSON.stringify(m)); const h = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.concat([Buffer.from([0x81, 126]), Buffer.from([p.length >> 8, p.length & 255])]); sock.write(Buffer.concat([h, p])); };
    let buf: Buffer = Buffer.alloc(0);
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); for (;;) { if (buf.length < 2) return; const op = buf[0] & 0x0f; const masked = !!(buf[1] & 0x80); let len = buf[1] & 0x7f; let o = 2; if (len === 126) { len = buf.readUInt16BE(2); o = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); o = 10; } const mask = masked ? buf.subarray(o, o + 4) : undefined; if (masked) o += 4; if (buf.length < o + len) return; const pl = Buffer.from(buf.subarray(o, o + len)); if (mask) for (let i = 0; i < pl.length; i++) pl[i] ^= mask[i & 3]; buf = buf.subarray(o + len); if (op === 8) { sock.end(); return; } if (op === 1) { try { onMessage(JSON.parse(pl.toString()), send); } catch { /* ignore */ } } } });
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res({ url: `ws://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => srv.close() })));
}
