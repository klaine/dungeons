/**
 * Sound, made in the browser from noise and a few oscillators: no recordings. Out of doors there
 * is wind, rising and falling, and leaves; indoors a low room tone. Footsteps follow the player's
 * stride and what is underfoot. Doors, keys, levers and finds each have a small sound of their own.
 *
 * Everything is kept quiet. Nothing here has been listened to by its author, who had no way to:
 * levels were set by measuring the output in a headless browser (ambience near -40 dB, footsteps
 * peaking near -25 dB) and the character of each sound is untested. Expect to adjust by ear.
 */

export type Surface = 'grass' | 'earth' | 'stone' | 'wood';
export type SoundEvent = 'door' | 'locked' | 'key' | 'find' | 'lever' | 'won';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private leaves: GainNode | null = null;
  private room: GainNode | null = null;
  private stride = 0;
  private outdoors = 1;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('dungeons.muted') === '1'; } catch { /* no storage: start with sound on */ }
  }

  /** Must be called from a click or a key press: browsers do not let a page make sound unasked. */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    // A gentle limiter, so that sounds landing together cannot add up to something loud.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -18; limit.ratio.value = 8; limit.attack.value = 0.005; limit.release.value = 0.2;
    this.master.connect(limit).connect(ctx.destination);

    // Two seconds of noise, looped, is the raw material for wind, leaves, room tone and footsteps.
    const length = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      // Slightly pink: each sample leans on the one before, which takes the hiss off.
      last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
      data[i] = last * 1.6;
    }
    const loop = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.start(0, Math.random() * 1.5);
      return src;
    };

    // Wind: noise through a band that wanders, louder in gusts.
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = 420; filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    loop().connect(filter).connect(gain).connect(this.master);
    this.wind = { gain, filter };
    // Leaves: the top of the same noise, very quiet.
    const high = ctx.createBiquadFilter();
    high.type = 'highpass'; high.frequency.value = 2600;
    this.leaves = ctx.createGain();
    this.leaves.gain.value = 0;
    loop().connect(high).connect(this.leaves).connect(this.master);
    // Indoors: only the bottom of it, as a room has.
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass'; low.frequency.value = 140;
    this.room = ctx.createGain();
    this.room.gain.value = 0;
    loop().connect(low).connect(this.room).connect(this.master);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem('dungeons.muted', this.muted ? '1' : '0'); } catch { /* not remembered */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /**
   * Called every frame. `outdoors` is 1 under the sky and 0 under a roof; `moved` is how far the
   * player went along the ground this frame.
   */
  update(dt: number, time: number, outdoors: number, moved: number, grounded: boolean, running: boolean, surface: Surface): void {
    const ctx = this.ctx;
    if (!ctx || !this.wind || !this.leaves || !this.room) return;
    this.outdoors += (outdoors - this.outdoors) * (1 - Math.exp(-dt * 1.5));
    const gust = 0.55 + 0.3 * Math.sin(time * 0.31) + 0.15 * Math.sin(time * 0.83 + 1.3);
    const now = ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(0.1 * gust * (0.15 + 0.85 * this.outdoors), now, 0.3);
    this.wind.filter.frequency.setTargetAtTime(320 + 260 * gust, now, 0.5);
    this.leaves.gain.setTargetAtTime(0.022 * gust * gust * this.outdoors, now, 0.3);
    this.room.gain.setTargetAtTime(0.09 * (1 - this.outdoors), now, 0.4);
    if (grounded && moved > 0) {
      this.stride += moved;
      const pace = running ? 1.15 : 0.78;
      if (this.stride > pace) {
        this.stride = 0;
        this.step(surface, running);
      }
    }
  }

  private burst(frequency: number, q: number, seconds: number, level: number, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now, Math.random() * 1.5, seconds + 0.05);
  }

  private step(surface: Surface, running: boolean): void {
    const vary = 0.85 + Math.random() * 0.3, loud = running ? 2.1 : 1.6;
    if (surface === 'grass') this.burst(1500 * vary, 0.6, 0.11, 0.045 * loud);
    else if (surface === 'earth') this.burst(700 * vary, 0.8, 0.09, 0.06 * loud);
    else if (surface === 'wood') { this.burst(260 * vary, 1.4, 0.12, 0.11 * loud); this.burst(1100 * vary, 1, 0.04, 0.03 * loud); }
    else { this.burst(520 * vary, 1.1, 0.07, 0.07 * loud); this.burst(2400 * vary, 1.2, 0.03, 0.035 * loud); }
  }

  private tone(frequency: number, seconds: number, level: number, type: OscillatorType = 'sine', glideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const now = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(frequency, now);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, now + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + seconds + 0.05);
  }

  play(event: SoundEvent): void {
    if (!this.ctx) return;
    switch (event) {
      case 'door':
        // A creak: a rough low note that slides, then the leaf coming to rest.
        this.tone(95, 0.55, 0.035, 'sawtooth', 150);
        this.tone(190, 0.5, 0.012, 'square', 260);
        this.burst(180, 1.2, 0.18, 0.09);
        break;
      case 'locked':
        this.burst(900, 2, 0.05, 0.07);
        this.burst(240, 1.5, 0.09, 0.07);
        break;
      case 'key':
        this.tone(1320, 0.5, 0.05);
        this.tone(1980, 0.7, 0.035, 'sine', undefined, 0.07);
        break;
      case 'find':
        this.tone(880, 0.6, 0.045);
        this.tone(1320, 0.8, 0.03, 'sine', undefined, 0.1);
        this.tone(1760, 1.0, 0.02, 'sine', undefined, 0.2);
        break;
      case 'lever':
        this.burst(320, 1.5, 0.12, 0.1);
        this.tone(60, 1.6, 0.06, 'sawtooth', 48, 0.1);
        this.burst(2000, 3, 1.4, 0.02);
        break;
      case 'won':
        [523, 659, 784, 1047].forEach((f, k) => this.tone(f, 1.6, 0.04, 'sine', undefined, k * 0.16));
        break;
    }
  }
}
