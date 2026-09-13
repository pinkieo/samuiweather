#!/usr/bin/env npx tsx
/**
 * Record a Sammi Broadcast episode from /studio (LENOVOX13).
 *
 *   npm run broadcast:render -- --slot 7
 *   npm run broadcast:render -- --hourly
 *
 * Needs: Chrome, ffmpeg, OPENAI_API_KEY, Next at BROADCAST_BASE_URL (default :3000).
 */

import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });

import OpenAI from 'openai';
import puppeteer from 'puppeteer-core';
import {
  parseBroadcastSlot,
  type BroadcastScript,
  type BroadcastSlot,
} from '../lib/broadcast-script';
import { episodeFromScript, scriptToVtt, type BroadcastManifest } from '../lib/broadcast-catalog';

const BASE = process.env.BROADCAST_BASE_URL ?? 'http://localhost:3000';
const OUT = resolve(process.cwd(), 'broadcast-out');
const CHROME =
  process.env.CHROME_PATH ??
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;

function findFfmpeg(): string {
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const root = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(root)) {
      const hit = walkFind(root, 'ffmpeg.exe', 6);
      if (hit) return hit;
    }
    const link = path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe');
    if (fs.existsSync(link)) return link;
  }
  return 'ffmpeg';
}

function walkFind(dir: string, name: string, depth: number): string | null {
  if (depth < 0) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
    if (e.isDirectory()) {
      const found = walkFind(p, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function ffmpeg(...args: string[]) {
  execFileSync(FFMPEG, args, { stdio: 'inherit' });
}

function parseArgs(): BroadcastSlot[] {
  const slots: BroadcastSlot[] = [];
  if (process.argv.includes('--hourly')) slots.push('hourly');
  const idx = process.argv.indexOf('--slot');
  if (idx !== -1) {
    const s = parseBroadcastSlot(process.argv[idx + 1] ?? '');
    if (!s || s === 'hourly') {
      if (s === 'hourly' && !slots.includes('hourly')) slots.push('hourly');
    } else {
      slots.push(s);
    }
  }
  if (slots.length === 0) {
    slots.push('feature_0700', 'hourly');
  }
  return slots;
}

async function fetchScript(slot: BroadcastSlot): Promise<BroadcastScript> {
  const res = await fetch(`${BASE}/api/broadcast/script?slot=${slot}`);
  const json = (await res.json()) as BroadcastScript & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `script HTTP ${res.status}`);
  return json;
}

function speakWindows(text: string, wavPath: string) {
  const txt = `${wavPath}.txt`;
  const ps1 = `${wavPath}.ps1`;
  fs.writeFileSync(txt, text, 'utf8');
  const body = `
Add-Type -AssemblyName System.Speech
$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speak.Rate = -1
$en = $speak.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'en*' } | Select-Object -First 1
if ($en) { $speak.SelectVoice($en.VoiceInfo.Name) }
$text = Get-Content -Raw -Encoding UTF8 ${JSON.stringify(txt)}
$speak.SetOutputToWaveFile(${JSON.stringify(wavPath)})
$speak.Speak($text)
$speak.Dispose()
`;
  fs.writeFileSync(ps1, body, 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
    stdio: 'inherit',
  });
}

let openaiTtsDisabled = false;

async function speakOpenAi(text: string, mp3Path: string): Promise<boolean> {
  if (openaiTtsDisabled) return false;
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return false;
  try {
    const openai = new OpenAI({ apiKey: key });
    const speech = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text.slice(0, 4000),
    });
    fs.writeFileSync(mp3Path, Buffer.from(await speech.arrayBuffer()));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    openaiTtsDisabled = true;
    console.warn(`OpenAI TTS failed (${msg.slice(0, 80)}). Using Windows English voice.`);
    return false;
  }
}

async function speakActs(script: BroadcastScript, dir: string): Promise<string> {
  const listPath = path.join(dir, 'concat.txt');
  const lines: string[] = [];
  for (let i = 0; i < script.acts.length; i++) {
    const act = script.acts[i]!;
    const rawMp3 = path.join(dir, `act-${i}.mp3`);
    const rawWav = path.join(dir, `act-${i}.wav`);
    const padded = path.join(dir, `act-${i}-pad.wav`);
    const text = act.lines.join(' ');
    const usedOpenAi = await speakOpenAi(text, rawMp3);
    const raw = usedOpenAi ? rawMp3 : rawWav;
    if (!usedOpenAi) speakWindows(text, rawWav);
    ffmpeg(
      '-y',
      '-i',
      raw,
      '-af',
      'apad',
      '-t',
      String(act.durationSec),
      '-ar',
      '44100',
      '-ac',
      '2',
      padded,
    );
    lines.push(`file '${padded.replace(/\\/g, '/')}'`);
  }
  fs.writeFileSync(listPath, lines.join('\n'));
  const audio = path.join(dir, 'voice.wav');
  ffmpeg('-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', audio);
  return audio;
}

async function recordStudio(slot: BroadcastSlot, dir: string, durationSec: number): Promise<number> {
  const framesDir = path.join(dir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--window-size=1920,1080', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1920, height: 1080 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  await page.goto(`${BASE}/studio?slot=${slot}&autoplay=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-studio-ready="true"]', { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));

  const started = Date.now();
  let n = 0;
  const intervalMs = 250;
  while (Date.now() - started < durationSec * 1000) {
    const file = path.join(framesDir, `${String(n).padStart(5, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 70 });
    n += 1;
    const ahead = started + n * intervalMs - Date.now();
    if (ahead > 0) await new Promise((r) => setTimeout(r, ahead));
  }
  await browser.close();
  return n;
}

const FFMPEG = findFfmpeg();

async function renderSlot(slot: BroadcastSlot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(OUT, `${slot}-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`slot ${slot} → ${dir}`);
  console.log(`ffmpeg ${FFMPEG}`);

  const script = await fetchScript(slot);
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(script, null, 2));
  console.log(`script ${script.kind} ${script.totalDurationSec}s delayed=${script.delayed}`);

  const audio = await speakActs(script, dir);
  const frames = await recordStudio(slot, dir, script.totalDurationSec);
  if (frames < 5) throw new Error(`only ${frames} frames captured`);
  const fps = Math.max(8, Math.min(30, frames / script.totalDurationSec));
  const mp4 = path.join(dir, `${slot}.mp4`);
  ffmpeg(
    '-y',
    '-framerate',
    fps.toFixed(3),
    '-i',
    path.join(dir, 'frames', '%05d.jpg'),
    '-i',
    audio,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-t',
    String(script.totalDurationSec),
    '-movflags',
    '+faststart',
    mp4,
  );
  console.log(`wrote ${mp4} (${frames} frames @ ${fps.toFixed(2)} fps)`);
  publishLatest(script, mp4);
  return mp4;
}

function publishLatest(script: BroadcastScript, mp4: string) {
  const destDir = resolve(process.cwd(), 'public', 'broadcast', 'latest');
  fs.mkdirSync(destDir, { recursive: true });
  const kindFile = script.kind === 'hourly' ? 'hourly' : 'feature';
  const destMp4 = path.join(destDir, `${kindFile}.mp4`);
  const destVtt = path.join(destDir, `${kindFile}.vtt`);
  fs.copyFileSync(mp4, destMp4);
  fs.writeFileSync(destVtt, scriptToVtt(script), 'utf8');
  const manifestPath = path.join(destDir, 'manifest.json');
  let manifest: BroadcastManifest = { feature: null, hourly: null };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BroadcastManifest;
  } catch {
    /* first publish */
  }
  const episode = episodeFromScript(script, {
    url: `/broadcast/latest/${kindFile}.mp4`,
    captionsUrl: `/broadcast/latest/${kindFile}.vtt`,
    publishedAt: new Date().toISOString(),
  });
  if (script.kind === 'hourly') manifest.hourly = episode;
  else manifest.feature = episode;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`published ${kindFile} → ${destMp4}`);
}

async function main() {
  const pubIdx = process.argv.indexOf('--publish-dir');
  if (pubIdx !== -1) {
    const dir = process.argv[pubIdx + 1];
    if (!dir) throw new Error('--publish-dir needs a folder');
    const script = JSON.parse(
      fs.readFileSync(path.join(dir, 'script.json'), 'utf8'),
    ) as BroadcastScript;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4'));
    const mp4 = files[0] ? path.join(dir, files[0]) : '';
    if (!mp4 || !fs.existsSync(mp4)) throw new Error(`no mp4 in ${dir}`);
    publishLatest(script, mp4);
    console.log(JSON.stringify({ ok: true, published: mp4 }, null, 2));
    return;
  }
  const slots = parseArgs();
  const written: string[] = [];
  for (const slot of slots) {
    written.push(await renderSlot(slot));
  }
  console.log(JSON.stringify({ ok: true, files: written }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
