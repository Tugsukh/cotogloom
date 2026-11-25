// Procedural Web Audio: footsteps (filtered noise, stereo-panned by position), heartbeat, chimes.
export class Audio {
  constructor() { this.ctx = null; this.ready = false; this.stats = { footsteps: 0, heartbeats: 0, chimes: 0 }; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    // half a second of white noise, reused for every footstep
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ready = true;
  }

  /** pan -1..1 (left..right), dist in metres (muffles far steps), vol 0..1 */
  footstep(pan, dist, vol) {
    if (!this.ready || vol <= 0.002) return;
    this.stats.footsteps++;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 260 + Math.random() * 160;
    bp.Q.value = 1.2;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(500, 4000 - dist * 180);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 1.4, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.13);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    src.connect(bp).connect(lp).connect(g);
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(this.master); } else g.connect(this.master);
    src.start(t, Math.random() * 0.3, 0.16);
  }

  thump(t, freq, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.15);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.22);
  }

  heartbeat(intensity) {
    if (!this.ready) return;
    this.stats.heartbeats++;
    const t = this.ctx.currentTime;
    this.thump(t, 62, 0.9 * intensity);
    this.thump(t + 0.17, 55, 0.65 * intensity);
  }

  tone(freq, start, dur, vol = 0.2, type = 'sine') {
    const c = this.ctx, t = c.currentTime + start;
    const o = c.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  chime(kind) {
    if (!this.ready) return;
    this.stats.chimes++;
    const seqs = {
      task: [[660, 0], [880, 0.09], [1320, 0.18]],
      unlock: [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.36]],
      wrong: [[220, 0, 'square'], [180, 0.12, 'square']],
      caught: [[300, 0, 'sawtooth'], [200, 0.15, 'sawtooth'], [120, 0.3, 'sawtooth']],
      escape: [[784, 0], [988, 0.1], [1175, 0.2], [1568, 0.3]],
      start: [[440, 0, 'triangle'], [440, 0.3, 'triangle'], [880, 0.6, 'triangle']],
      blip: [[900, 0]],
    };
    for (const [f, s, type] of seqs[kind] ?? seqs.blip) this.tone(f, s, 0.35, 0.12, type ?? 'sine');
  }

  swoosh() {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2000, t + 0.15);
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, 0, 0.22);
  }
}
