/**
 * Deterministic video export: renders every frame (t = frame / fps) in headless
 * Chromium, renders the audio offline with the same score, and muxes both with ffmpeg.
 *
 *   npm run export -- --seed 0xF5E68707
 *   npm run export -- --seed 42 --mode drift --out out/drift-42.mp4
 *   npm run export -- --config my-piece.json --scale 0.5      # quick 540×960 draft
 *   npm run export -- --seed 42 --frames out/frames           # PNG sequence only
 *   npm run export -- --seed 42 --crf 22                       # smaller file (default CRF 16)
 *   npm run export -- --seed 42 --size 25                      # aim for a 25 MB file
 *
 * Requires ffmpeg on PATH and Playwright's Chromium.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { ChordDriftConfig, DeepPartial } from '../src/engine';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Args {
  config?: string;
  seed?: string;
  mode?: string;
  key?: string;
  out?: string;
  frames?: string;
  scale: number;
  fps?: number;
  jpeg: boolean;
  noAudio: boolean;
  build: boolean;
  crf: number;
  /** Target file size in MB (overrides --crf with a matching bitrate). */
  size?: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { scale: 1, jpeg: false, noAudio: false, build: false, crf: 16 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--config') a.config = next();
    else if (k === '--seed') a.seed = next();
    else if (k === '--mode') a.mode = next();
    else if (k === '--key') a.key = next();
    else if (k === '--out') a.out = next();
    else if (k === '--frames') a.frames = next();
    else if (k === '--scale') a.scale = Number(next());
    else if (k === '--fps') a.fps = Number(next());
    else if (k === '--crf') a.crf = Number(next());
    else if (k === '--size') a.size = Number(next());
    else if (k === '--jpeg') a.jpeg = true;
    else if (k === '--no-audio') a.noAudio = true;
    else if (k === '--build') a.build = true;
    else if (k === '--help' || k === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`Unknown argument ${k}`);
  }
  return a;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function serve(dir: string): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = join(dir, path === '/' ? 'index.html' : path);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      ok({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
    }),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dist = join(root, 'dist');
  if (args.build || !existsSync(join(dist, 'index.html'))) {
    console.log('Building player…');
    const r = spawnSync('npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('vite build failed');
  }

  const patch: DeepPartial<ChordDriftConfig> = args.config ? JSON.parse(readFileSync(args.config, 'utf8')) : {};
  if (args.seed) patch.seed = args.seed;
  if (args.mode) patch.mode = args.mode as ChordDriftConfig['mode'];
  if (args.key) patch.key = args.key;
  const video = { ...(patch.video ?? {}) };
  if (args.fps) video.fps = args.fps;
  if (args.scale !== 1) {
    video.width = Math.round(((video.width ?? 1080) * args.scale) / 2) * 2;
    video.height = Math.round(((video.height ?? 1920) * args.scale) / 2) * 2;
  }
  patch.video = video;

  const { chromium } = await import('playwright');
  const server = await serve(dist);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${server.url}index.html?export`);
    await page.waitForFunction(() => 'chordDrift' in window);
    await page.evaluate(() => (window as any).chordDrift.ready);
    const info = await page.evaluate((p) => (window as any).chordDrift.load(p), patch as any);
    console.log(`seed ${info.seed} · key ${info.key} · ${info.chords.join(' → ')}`);
    console.log(`${info.width}×${info.height} @ ${info.fps} fps · ${info.frames} frames · ${info.duration.toFixed(2)} s`);

    const outFile = resolve(args.out ?? join(root, 'out', `chord-drift-${info.seed}.mp4`));
    const type = args.jpeg ? 'image/jpeg' : 'image/png';
    const started = Date.now();
    const progress = (n: number) => {
      if (n % 30 !== 0 && n !== info.frames - 1) return;
      const fps = (n + 1) / ((Date.now() - started) / 1000);
      process.stdout.write(`\r  frame ${n + 1}/${info.frames}  (${fps.toFixed(1)} fps render)   `);
    };

    if (args.frames) {
      const dir = resolve(args.frames);
      mkdirSync(dir, { recursive: true });
      for (let n = 0; n < info.frames; n++) {
        const b64: string = await page.evaluate(([i, t]) => (window as any).chordDrift.frame(i, t), [n, type] as const);
        writeFileSync(join(dir, `${String(n).padStart(5, '0')}.${args.jpeg ? 'jpg' : 'png'}`), Buffer.from(b64, 'base64'));
        progress(n);
      }
      console.log(`\nWrote ${info.frames} frames to ${dir}`);
      if (!args.noAudio) {
        const wav = Buffer.from(await page.evaluate(() => (window as any).chordDrift.wav()), 'base64');
        writeFileSync(join(dir, 'audio.wav'), wav);
        console.log(`Wrote ${join(dir, 'audio.wav')}`);
      }
      return;
    }

    mkdirSync(dirname(outFile), { recursive: true });
    let wavPath: string | null = null;
    if (!args.noAudio) {
      process.stdout.write('Rendering audio… ');
      const wav = Buffer.from(await page.evaluate(() => (window as any).chordDrift.wav()), 'base64');
      wavPath = outFile.replace(/\.[^.]+$/, '') + '.wav';
      writeFileSync(wavPath, wav);
      console.log(`${(wav.length / 1e6).toFixed(1)} MB → ${wavPath}`);
    }

    const ff = spawn(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(info.fps), '-i', '-',
        ...(wavPath ? ['-i', wavPath] : []),
        '-c:v', 'libx264', '-preset', 'medium',
        ...(args.size
          ? (() => {
              // A target size: the bitrate that fills it (less the audio), capped so a short piece doesn't balloon.
              const kbps = Math.max(300, Math.round((args.size! * 8000) / info.duration - (wavPath ? 192 : 0)));
              return ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`];
            })()
          : ['-crf', String(args.crf)]),
        '-pix_fmt', 'yuv420p',
        ...(wavPath ? ['-c:a', 'aac', '-b:a', '192k'] : []),
        '-movflags', '+faststart',
        '-t', info.duration.toFixed(3),
        outFile,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const done = new Promise<void>((ok, fail) => ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`)))));

    for (let n = 0; n < info.frames; n++) {
      const b64: string = await page.evaluate(([i, t]) => (window as any).chordDrift.frame(i, t), [n, type] as const);
      if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise((ok) => ff.stdin.once('drain', ok));
      progress(n);
    }
    ff.stdin.end();
    await done;
    console.log(`\nWrote ${outFile}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
