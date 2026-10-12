/**
 * WebAudio synth. Everything is synthesised; there are no audio files.
 *
 *   one-shots ─┬─► dry bus ───────────────┐
 *              └─► reverb send ─► convolver (procedural temple-hall IR) ─► wet ─┤
 *   ambience (stereo pink noise, LFO gusts) ─────────────────────────────────────┤
 *                                                    DynamicsCompressor ◄────────┘
 *                                                           │
 *                                                master gain (0.8 / 0 muted) ─► destination
 *
 * Sounds: clack (8-voice pool, two Q8 bandpasses), thunk, scrape, pop, 木鱼 woodfish,
 * 磬 bell (inharmonic partials with beating pairs), gong (swelling partials + bloom filter),
 * 筊杯 landing, and the wind ambience.
 *
 * `SynthEngine` works on any BaseAudioContext so it can be rendered offline for level checks.
 * The `audio` singleton owns the live AudioContext: created + resumed synchronously in unlock()
 * (call it inside the gate gesture), suspended while the page is hidden.
 */
import { bus } from '@/lib/bus';
import { getState, useStore } from '@/state/store';

export type SoundName = 'clack' | 'thunk' | 'scrape' | 'pop' | 'woodfish' | 'bell' | 'gong' | 'jiaobei';
export interface PlayOpts {
  /** 0..1 impact strength (clack, thunk, jiaobei). */
  force?: number;
  /** Scrape length in ms. */
  durationMs?: number;
}

const MASTER_GAIN = 0.8;
const CLACK_VOICES = 8;
const CLACK_GAP_S = 0.03;
/** Bandpassed noise loses most of its energy; make-up gain so clacks sit at their intended levels. */
const CLACK_MAKEUP = 3.8;
const MAX_ONESHOTS = 28;

const clamp01 = (v: number | undefined, d: number): number => {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return x < 0 ? 0 : x > 1 ? 1 : x;
};
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Linear attack to `peak`, then exponential decay with time-constant `tau` (s). */
function envelope(p: AudioParam, t: number, peak: number, attack: number, tau: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(0, t + attack, tau);
}

// ───────────────────────────── procedural buffers ─────────────────────────────

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Stereo pink noise (Paul Kellet's refined filter), crossfaded so it loops without a seam. */
function pinkNoiseLoop(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const fade = Math.floor(sr * 0.35);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const out = buf.getChannelData(ch);
    const raw = new Float32Array(len + fade);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    for (let i = 0; i < len; i++) out[i] = raw[i]!;
    // Blend the overflow tail into the head with an equal-power crossfade.
    for (let i = 0; i < fade; i++) {
      const x = i / fade;
      out[i] = raw[i]! * Math.sin((x * Math.PI) / 2) + raw[len + i]! * Math.cos((x * Math.PI) / 2);
    }
  }
  return buf;
}

/**
 * Temple-hall impulse response: 18 ms pre-delay, sparse early reflections off stone and timber,
 * then a diffuse tail (RT60 ≈ 2.4 s) that darkens over time. Decorrelated per channel.
 */
function hallImpulse(ctx: BaseAudioContext, seconds = 2.6): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.018);
  const buf = ctx.createBuffer(2, len, sr);
  const tau = 2.4 / 6.91;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp(-t / tau) * Math.min(1, t / 0.012);
      // Air and timber absorb highs first: one-pole low-pass that closes along the tail.
      const a = 0.85 - 0.7 * Math.min(1, t / 1.6);
      lp += a * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env * 0.55;
    }
    const taps = [0.011, 0.019, 0.027, 0.041, 0.053, 0.067, 0.083];
    taps.forEach((tt, k) => {
      const at = pre + Math.floor(sr * (tt + (ch ? 0.0023 * (k % 3) : 0.0017 * ((k + 1) % 3))));
      if (at < len) d[at] = (d[at] ?? 0) + (k % 2 ? -1 : 1) * 0.5 * Math.exp(-k * 0.33);
    });
  }
  return buf;
}

// ───────────────────────────── engine ─────────────────────────────

interface ClackVoice {
  bp1: BiquadFilterNode;
  bp2: BiquadFilterNode;
  out: GainNode;
  src: AudioBufferSourceNode | null;
  busyUntil: number;
}

/** The synth graph on any BaseAudioContext (live or offline). */
export class SynthEngine {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly comp: DynamicsCompressorNode;
  private readonly dry: GainNode;
  private readonly send: GainNode;
  private readonly noise: AudioBuffer;
  private pink: AudioBuffer | null = null;
  private readonly voices: ClackVoice[] = [];
  private nextVoice = 0;
  private lastClack = -Infinity;
  private lastBell = -Infinity;
  private lastGong = -Infinity;
  private oneShots = 0;
  private amb: { src: AudioBufferSourceNode; gain: GainNode; nodes: AudioNode[]; oscs: OscillatorNode[] } | null = null;

  constructor(ctx: BaseAudioContext, destination: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.22;
    this.comp.connect(this.master);
    this.master.connect(destination);

    this.dry = ctx.createGain();
    this.dry.connect(this.comp);

    const convolver = ctx.createConvolver();
    convolver.normalize = true;
    convolver.buffer = hallImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    this.send = ctx.createGain();
    this.send.connect(convolver);
    convolver.connect(wet);
    wet.connect(this.comp);

    this.noise = whiteNoise(ctx, 1.5);
    for (let i = 0; i < CLACK_VOICES; i++) this.voices.push(this.makeClackVoice());
  }

  /** Scheduling time with a few ms of look-ahead so attacks are never clipped. */
  private get t0(): number {
    return this.ctx.currentTime + 0.004;
  }

  /** Route `node` to the dry bus (+ reverb send, + pan). Returns the routing nodes it created. */
  private out(node: AudioNode, sendLevel: number, pan = 0): AudioNode[] {
    const made: AudioNode[] = [];
    let tail: AudioNode = node;
    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p);
      tail = p;
      made.push(p);
    }
    tail.connect(this.dry);
    if (sendLevel > 0) {
      const s = this.ctx.createGain();
      s.gain.value = sendLevel;
      tail.connect(s);
      s.connect(this.send);
      made.push(s);
    }
    return made;
  }

  private noiseSource(t: number, dur: number, loop = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    const offset = Math.random() * Math.max(0, this.noise.duration - (loop ? 0 : dur) - 0.01);
    src.start(t, offset);
    src.stop(t + dur);
    return src;
  }

  /** Track a one-shot's nodes and disconnect them when its last source ends. */
  private track(sources: AudioScheduledSourceNode[], nodes: AudioNode[]): void {
    this.oneShots++;
    let left = sources.length;
    const done = (): void => {
      if (--left > 0) return;
      this.oneShots = Math.max(0, this.oneShots - 1);
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          // already disconnected
        }
      }
    };
    for (const s of sources) s.onended = done;
  }

  private busy(): boolean {
    return this.oneShots >= MAX_ONESHOTS;
  }

  // ── clack: pooled voices ──

  private makeClackVoice(): ClackVoice {
    const c = this.ctx;
    const bp1 = c.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.Q.value = 8;
    const bp2 = c.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.Q.value = 8;
    const g2 = c.createGain();
    g2.gain.value = 0.6;
    const out = c.createGain();
    out.gain.value = 0;
    bp1.connect(out);
    bp2.connect(g2);
    g2.connect(out);
    this.out(out, 0.12, (this.voices.length % 2 ? 1 : -1) * (0.12 + 0.05 * this.voices.length));
    return { bp1, bp2, out, src: null, busyUntil: 0 };
  }

  clack(force = 0.5): void {
    const t = this.t0;
    if (t - this.lastClack < CLACK_GAP_S) return;
    this.lastClack = t;
    const f = clamp01(force, 0.5);
    // Prefer a free voice, otherwise steal round-robin.
    let v = this.voices.find((x) => x.busyUntil <= t);
    if (!v) {
      v = this.voices[this.nextVoice % CLACK_VOICES]!;
      this.nextVoice++;
    }
    if (v.src) {
      try {
        v.src.stop(t);
      } catch {
        // already stopped
      }
      v.src.disconnect();
    }
    const f1 = rand(1400, 2800) + f * 300;
    v.bp1.frequency.setValueAtTime(f1, t);
    v.bp2.frequency.setValueAtTime(f1 * 1.47, t);
    const src = this.noiseSource(t, 0.04);
    src.connect(v.bp1);
    src.connect(v.bp2);
    envelope(v.out.gain, t, (0.08 + 0.35 * f) * CLACK_MAKEUP, 0.0015, 0.0075);
    v.src = src;
    v.busyUntil = t + 0.045;
    src.onended = () => {
      if (v.src === src) v.src = null;
      src.disconnect();
    };
  }

  // ── thunk: stick or block hitting the lacquered altar ──

  thunk(force = 0.5): void {
    if (this.busy()) return;
    const c = this.ctx;
    const t = this.t0;
    const f = clamp01(force, 0.5);
    // Base level 0.12 + 0.5·force, trimmed so landings sit under the bell.
    const level = (0.12 + 0.5 * f) * 0.6;

    const n = this.noiseSource(t, 0.14);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 0.8;
    const ng = c.createGain();
    envelope(ng.gain, t, level * 1.4, 0.002, 0.035);
    n.connect(lp);
    lp.connect(ng);

    // Wooden knock on top so it reads on phone speakers.
    const knock = c.createBiquadFilter();
    knock.type = 'bandpass';
    knock.frequency.value = rand(820, 980);
    knock.Q.value = 5;
    const kg = c.createGain();
    envelope(kg.gain, t, level * 1.1, 0.001, 0.018);
    n.connect(knock);
    knock.connect(kg);

    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    const og = c.createGain();
    envelope(og.gain, t, level * 0.9, 0.003, 0.04);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.16);

    const mix = c.createGain();
    ng.connect(mix);
    kg.connect(mix);
    og.connect(mix);
    const routed = this.out(mix, 0.18, rand(-0.15, 0.15));
    this.track([n, o], [n, lp, ng, knock, kg, o, og, mix, ...routed]);
  }

  // ── scrape: a bamboo stick sliding along the tube wall ──

  scrape(durationMs = 600): void {
    if (this.busy()) return;
    const c = this.ctx;
    const t = this.t0;
    const d = Math.max(0.08, Math.min(3, durationMs / 1000));
    const n = this.noiseSource(t, d + 0.1, true);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.6;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + d);
    // Stick-slip chatter: an irregular ~30 Hz amplitude flutter.
    const am = c.createGain();
    am.gain.value = 0.6;
    const lfo = c.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.setValueAtTime(rand(26, 34), t);
    lfo.frequency.linearRampToValueAtTime(rand(36, 46), t + d);
    const depth = c.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth);
    depth.connect(am.gain);
    lfo.start(t);
    lfo.stop(t + d + 0.1);
    const env = c.createGain();
    const g = env.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(0.12 * 3.8, t + Math.min(0.05, d * 0.3));
    g.setValueAtTime(0.12 * 3.8, t + d * 0.85);
    g.linearRampToValueAtTime(0, t + d + 0.06);
    n.connect(bp);
    bp.connect(am);
    am.connect(env);
    const routed = this.out(env, 0.1, rand(-0.1, 0.1));
    this.track([n, lfo], [n, bp, am, lfo, depth, env, ...routed]);
  }

  // ── pop: the stick leaving the tube ──

  pop(): void {
    if (this.busy()) return;
    const c = this.ctx;
    const t = this.t0;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(1200, t + 0.02);
    const og = c.createGain();
    envelope(og.gain, t, 0.26, 0.001, 0.014);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.09);

    const n = this.noiseSource(t, 0.03);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const ng = c.createGain();
    envelope(ng.gain, t, 0.13, 0.0005, 0.004);
    n.connect(hp);
    hp.connect(ng);

    const mix = c.createGain();
    og.connect(mix);
    ng.connect(mix);
    const routed = this.out(mix, 0.2);
    this.track([o, n], [o, og, n, hp, ng, mix, ...routed]);
  }

  // ── 木鱼: hollow temple wood block ──

  woodfish(): void {
    if (this.busy()) return;
    const c = this.ctx;
    const t = this.t0;
    const f0 = rand(745, 775);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.79, t + 0.04);
    const og = c.createGain();
    envelope(og.gain, t, 0.5, 0.0015, 0.03);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.2);

    // Inharmonic cavity mode for the hollow body.
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f0 * 2.31, t);
    o2.frequency.exponentialRampToValueAtTime(f0 * 2.31 * 0.86, t + 0.03);
    const o2g = c.createGain();
    envelope(o2g.gain, t, 0.14, 0.001, 0.012);
    o2.connect(o2g);
    o2.start(t);
    o2.stop(t + 0.1);

    const n = this.noiseSource(t, 0.03);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000;
    bp.Q.value = 1.4;
    const ng = c.createGain();
    envelope(ng.gain, t, 0.5, 0.0005, 0.0035);
    n.connect(bp);
    bp.connect(ng);

    const mix = c.createGain();
    mix.gain.value = 0.55;
    og.connect(mix);
    o2g.connect(mix);
    ng.connect(mix);
    const routed = this.out(mix, 0.3);
    this.track([o, o2, n], [o, og, o2, o2g, n, bp, ng, mix, ...routed]);
  }

  // ── 磬: stone chime, inharmonic partials with slow beating ──

  bell(): void {
    const c = this.ctx;
    const t = this.t0;
    if (t - this.lastBell < 0.25) return;
    this.lastBell = t;
    const f0 = 520;
    const ratios = [1, 2.76, 5.4, 8.93, 13.34];
    const gains = [1, 0.6, 0.4, 0.25, 0.15];
    const decays = [4.0, 2.5, 1.6, 1.0, 0.6];
    const mix = c.createGain();
    mix.gain.value = 0.13;
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [mix];
    const nyq = c.sampleRate / 2;
    ratios.forEach((r, i) => {
      const f = f0 * r;
      if (f * 1.01 > nyq) return;
      const g = c.createGain();
      // Decay figures are the time to about −45 dB.
      envelope(g.gain, t, gains[i]!, 0.002, decays[i]! / 5.2);
      g.connect(mix);
      nodes.push(g);
      // Two slightly detuned oscillators per partial: the slow shimmer of a struck stone.
      const beat = 0.35 + i * 0.27;
      for (const s of [-1, 1]) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f + (s * beat) / 2;
        const half = c.createGain();
        half.gain.value = 0.5;
        o.connect(half);
        half.connect(g);
        o.start(t);
        o.stop(t + decays[i]! + 0.3);
        sources.push(o);
        nodes.push(o, half);
      }
    });
    // Mallet strike.
    const n = this.noiseSource(t, 0.06);
    const hp = c.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 3800;
    hp.Q.value = 0.9;
    const ng = c.createGain();
    envelope(ng.gain, t, 0.9, 0.0008, 0.008);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(mix);
    sources.push(n);
    nodes.push(n, hp, ng);
    nodes.push(...this.out(mix, 0.5));
    this.track(sources, nodes);
  }

  // ── gong: 上上签 / 圣筊 / 请客签 ──

  gong(): void {
    const c = this.ctx;
    const t = this.t0;
    if (t - this.lastGong < 0.4) return;
    this.lastGong = t;
    const f0 = 110;
    const ratios = [1, 1.47, 2.09, 2.56, 3.12];
    const gains = [1, 0.72, 0.55, 0.42, 0.3];
    const decays = [5.0, 4.2, 3.4, 2.7, 2.1];
    // Brightness bloom: the tone opens up during the swell, then mellows.
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(3200, t + 0.18);
    lp.frequency.setTargetAtTime(900, t + 0.25, 1.2);
    const mix = c.createGain();
    mix.gain.value = 0.2;
    lp.connect(mix);
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [lp, mix];
    ratios.forEach((r, i) => {
      const f = f0 * r;
      const g = c.createGain();
      const swell = 0.15 * (1 + i * 0.35);
      const p = g.gain;
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(gains[i]! * 0.35, t + 0.01);
      p.linearRampToValueAtTime(gains[i]!, t + swell);
      p.setTargetAtTime(0, t + swell, decays[i]! / 5);
      g.connect(lp);
      nodes.push(g);
      const beat = 0.6 + i * 0.45;
      for (const s of [-1, 1]) {
        const o = c.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        // A gentle downward pitch glide, like a large temple gong settling.
        const fs = f + (s * beat) / 2;
        o.frequency.setValueAtTime(fs * 1.012, t);
        o.frequency.exponentialRampToValueAtTime(fs, t + 1.2);
        const half = c.createGain();
        half.gain.value = i === 0 ? 0.5 : 0.32;
        o.connect(half);
        half.connect(g);
        o.start(t);
        o.stop(t + decays[i]! + 0.5);
        sources.push(o);
        nodes.push(o, half);
      }
    });
    // Soft felt mallet thump.
    const n = this.noiseSource(t, 0.3);
    const nl = c.createBiquadFilter();
    nl.type = 'lowpass';
    nl.frequency.value = 220;
    const ng = c.createGain();
    envelope(ng.gain, t, 1.6, 0.004, 0.06);
    n.connect(nl);
    nl.connect(ng);
    ng.connect(mix);
    sources.push(n);
    nodes.push(n, nl, ng);
    nodes.push(...this.out(mix, 0.55));
    this.track(sources, nodes);
  }

  // ── 筊杯 landing: crescent wood block on the altar ──

  jiaobei(force = 0.5): void {
    if (this.busy()) return;
    const c = this.ctx;
    const t = this.t0;
    const f = clamp01(force, 0.5);
    const level = 0.1 + 0.4 * f;
    const f1 = rand(640, 980) + f * 120;
    const n = this.noiseSource(t, 0.12);
    const b1 = c.createBiquadFilter();
    b1.type = 'bandpass';
    b1.frequency.value = f1;
    b1.Q.value = 9;
    const b2 = c.createBiquadFilter();
    b2.type = 'bandpass';
    b2.frequency.value = f1 * 2.13;
    b2.Q.value = 7;
    const b2g = c.createGain();
    b2g.gain.value = 0.5;
    const tg = c.createGain();
    envelope(tg.gain, t, level * 5, 0.001, 0.022);
    n.connect(b1);
    n.connect(b2);
    b1.connect(tg);
    b2.connect(b2g);
    b2g.connect(tg);

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    const lg = c.createGain();
    envelope(lg.gain, t, level * 1.2, 0.002, 0.03);
    n.connect(lp);
    lp.connect(lg);

    const mix = c.createGain();
    tg.connect(mix);
    lg.connect(mix);
    const routed = this.out(mix, 0.2, rand(-0.25, 0.25));
    this.track([n], [n, b1, b2, b2g, tg, lp, lg, mix, ...routed]);
  }

  play(name: SoundName, opts?: PlayOpts): void {
    switch (name) {
      case 'clack':
        this.clack(opts?.force);
        break;
      case 'thunk':
        this.thunk(opts?.force);
        break;
      case 'scrape':
        this.scrape(opts?.durationMs);
        break;
      case 'pop':
        this.pop();
        break;
      case 'woodfish':
        this.woodfish();
        break;
      case 'bell':
        this.bell();
        break;
      case 'gong':
        this.gong();
        break;
      case 'jiaobei':
        this.jiaobei(opts?.force);
        break;
    }
  }

  // ── wind ambience ──

  get ambienceOn(): boolean {
    return this.amb !== null;
  }

  startAmbience(fadeS = 3): void {
    if (this.amb) return;
    const c = this.ctx;
    const t = this.t0;
    this.pink ??= pinkNoiseLoop(c, 7);
    const src = c.createBufferSource();
    src.buffer = this.pink;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.Q.value = 0.5;
    // Slow breathing of the wind (0.07 Hz) and an even slower gust on the cutoff.
    const breath = c.createGain();
    breath.gain.value = 1;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.38;
    lfo.connect(lfoDepth);
    lfoDepth.connect(breath.gain);
    const gust = c.createOscillator();
    gust.frequency.value = 0.031;
    const gustDepth = c.createGain();
    gustDepth.gain.value = 170;
    gust.connect(gustDepth);
    gustDepth.connect(lp.frequency);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.015 * 2.2, t + fadeS);
    src.connect(lp);
    lp.connect(breath);
    breath.connect(gain);
    gain.connect(this.comp);
    src.start(t, Math.random() * 3);
    lfo.start(t);
    gust.start(t);
    this.amb = { src, gain, nodes: [src, lp, breath, lfo, lfoDepth, gust, gustDepth, gain], oscs: [lfo, gust] };
  }

  stopAmbience(fadeS = 0.8): void {
    const a = this.amb;
    if (!a) return;
    this.amb = null;
    const t = this.ctx.currentTime;
    a.gain.gain.cancelScheduledValues(t);
    a.gain.gain.setValueAtTime(a.gain.gain.value, t);
    a.gain.gain.linearRampToValueAtTime(0, t + fadeS);
    const end = t + fadeS + 0.05;
    try {
      a.src.stop(end);
      for (const o of a.oscs) o.stop(end);
    } catch {
      // already stopped
    }
    a.src.onended = () => {
      for (const n of a.nodes) {
        try {
          n.disconnect();
        } catch {
          // ignore
        }
      }
    };
  }

  setMuted(m: boolean): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, t, 0.03);
  }
}

// ───────────────────────────── live singleton ─────────────────────────────

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let engine: SynthEngine | null = null;
let muted = false;
let wantAmbience = false;
let hidden = false;

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function running(): boolean {
  return !!ctx && ctx.state === 'running' && !hidden;
}

/** Start ambience once the context actually runs (resume() is async on most browsers). */
function syncAmbience(): void {
  if (!engine) return;
  const should = wantAmbience && !muted;
  if (should && !engine.ambienceOn && running()) engine.startAmbience();
  else if (!should && engine.ambienceOn) engine.stopAmbience();
}

function tryResume(): void {
  if (!ctx || hidden || ctx.state === 'running' || ctx.state === 'closed') return;
  try {
    void ctx.resume().then(syncAmbience, () => undefined);
  } catch {
    // ignore
  }
}

export const audio: {
  unlock(): void;
  setMuted(m: boolean): void;
  suspend(): void;
  resume(): void;
  play(name: SoundName, opts?: PlayOpts): void;
  startAmbience(): void;
  stopAmbience(): void;
} = {
  /** Create and resume the AudioContext. Call synchronously inside a user gesture. */
  unlock(): void {
    if (!ctx) {
      const AC = audioCtor();
      if (!AC) return;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        try {
          ctx = new AC();
        } catch {
          return;
        }
      }
      ctx.onstatechange = syncAmbience;
      // resume() first, in this tick, before any heavier work.
      tryResume();
      try {
        // iOS: playing a silent buffer inside the gesture fully unlocks output.
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
        engine = new SynthEngine(ctx);
        engine.master.gain.value = muted ? 0 : MASTER_GAIN;
      } catch (err) {
        console.error('[audio] init failed', err);
        engine = null;
      }
      return;
    }
    tryResume();
  },

  setMuted(m: boolean): void {
    muted = m;
    engine?.setMuted(m);
    syncAmbience();
  },

  /** Page hidden: silence everything and let the device sleep. */
  suspend(): void {
    hidden = true;
    if (ctx && ctx.state === 'running') {
      try {
        void ctx.suspend().catch(() => undefined);
      } catch {
        // ignore
      }
    }
  },

  resume(): void {
    hidden = false;
    tryResume();
  },

  play(name: SoundName, opts?: PlayOpts): void {
    if (muted || !engine || !running()) return;
    try {
      engine.play(name, opts);
    } catch (err) {
      console.error(`[audio] ${name} failed`, err);
    }
  },

  startAmbience(): void {
    wantAmbience = true;
    syncAmbience();
  },

  stopAmbience(): void {
    wantAmbience = false;
    syncAmbience();
  },
};

/**
 * Subscribe the synth to the bus and the 音效 setting. Also unlocks audio on the first user
 * gesture anywhere (desktop has no gate) and re-resumes after iOS interruptions.
 */
export function wireAudioToBus(): () => void {
  audio.setMuted(!getState().settings.sound);

  const onGesture = (): void => {
    const phase = getState().phase;
    audio.unlock();
    // The gate's own button starts the ambience; elsewhere the first gesture does.
    if (phase !== 'boot' && phase !== 'gate') audio.startAmbience();
  };
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onGesture, opts);
    window.addEventListener('keydown', onGesture, opts);
    window.addEventListener('touchend', onGesture, opts);
  }

  const offs = [
    bus.on('clack', ({ force }) => audio.play('clack', { force })),
    bus.on('thunk', ({ force }) => audio.play('thunk', { force })),
    bus.on('scrape', ({ durationMs }) => audio.play('scrape', { durationMs })),
    bus.on('pop', () => audio.play('pop')),
    bus.on('bell', () => audio.play('bell')),
    bus.on('gong', () => audio.play('gong')),
    bus.on('woodfish', () => audio.play('woodfish')),
    bus.on('meter-full', () => audio.play('woodfish')),
    bus.on('jiaobei-land', ({ force }) => audio.play('jiaobei', { force })),
    useStore.subscribe((s, prev) => {
      if (s.settings.sound !== prev.settings.sound) audio.setMuted(!s.settings.sound);
    }),
  ];

  return () => {
    for (const off of offs) off();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', onGesture, opts);
      window.removeEventListener('keydown', onGesture, opts);
      window.removeEventListener('touchend', onGesture, opts);
    }
  };
}
