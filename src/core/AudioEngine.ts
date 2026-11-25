import type { SurfaceMaterialType } from '../types';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private reverbNode!: ConvolverNode;
  private reverbGain!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private ambientStarted = false;

  public init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx();

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.16;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.82;
    this.masterGain.connect(comp);
    comp.connect(this.ctx.destination);

    // White noise buffer (2 seconds)
    const sr = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, sr * 2, sr);
    const nd = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < nd.length; i++) {
      nd[i] = Math.random() * 2 - 1;
    }

    // Concrete underground hall Impulse Response (1.35s stereo)
    const irLen = Math.floor(sr * 1.35);
    const ir = this.ctx.createBuffer(2, irLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / sr;
        const early = (i === Math.floor(sr * 0.018) || i === Math.floor(sr * 0.039)) ? 0.55 : 0;
        const decay = Math.exp(-t * 4.6) * (0.65 + 0.35 * Math.exp(-t * 18));
        d[i] = (Math.random() * 2 - 1) * decay + early * (ch === 0 ? 1 : -1);
      }
    }
    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = ir;
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.34;
    this.reverbNode.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);

    this.startAmbientHum();
  }

  private startAmbientHum(): void {
    if (!this.ctx || this.ambientStarted) return;
    this.ambientStarted = true;

    // Deep cryo-facility sub-hum
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 46;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 115;
    const g = this.ctx.createGain();
    g.gain.value = 0.045;
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
    osc.start();

    // Ventilation air hiss
    const air = this.ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    air.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.8;
    const ag = this.ctx.createGain();
    ag.gain.value = 0.016;
    air.connect(bp);
    bp.connect(ag);
    ag.connect(this.masterGain);
    air.start();
  }

  public playGunshot(suppressed: boolean, ammoRemaining: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const pitchJitter = 0.96 + Math.random() * 0.08;

    // Layer 1: Sub-bass chest thump
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime((suppressed ? 95 : 138) * pitchJitter, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + (suppressed ? 0.065 : 0.11));
    const subG = this.ctx.createGain();
    subG.gain.setValueAtTime(suppressed ? 0.42 : 0.72, t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + (suppressed ? 0.075 : 0.13));
    sub.connect(subG);
    subG.connect(this.masterGain);
    sub.start(t);
    sub.stop(t + 0.15);

    // Layer 2: Propellant crack / suppressed gas puff
    const burst = this.ctx.createBufferSource();
    burst.buffer = this.noiseBuffer;
    burst.playbackRate.value = pitchJitter;

    const filter = this.ctx.createBiquadFilter();
    if (suppressed) {
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1650, t);
      filter.frequency.exponentialRampToValueAtTime(520, t + 0.07);
      filter.Q.value = 1.1;
    } else {
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(5600, t);
      filter.frequency.exponentialRampToValueAtTime(420, t + 0.18);
    }

    const bGain = this.ctx.createGain();
    bGain.gain.setValueAtTime(suppressed ? 0.34 : 0.82, t);
    bGain.gain.exponentialRampToValueAtTime(0.001, t + (suppressed ? 0.085 : 0.21));

    burst.connect(filter);
    filter.connect(bGain);
    bGain.connect(this.masterGain);
    if (!suppressed) {
      bGain.connect(this.reverbNode);
    } else {
      const supSend = this.ctx.createGain();
      supSend.gain.value = 0.18;
      bGain.connect(supSend);
      supSend.connect(this.reverbNode);
    }
    burst.start(t);
    burst.stop(t + 0.24);

    // Layer 3: Mechanical Bolt Carrier Steel Clack
    const mech = this.ctx.createOscillator();
    mech.type = 'triangle';
    mech.frequency.setValueAtTime(2150 * pitchJitter, t + 0.012);
    mech.frequency.exponentialRampToValueAtTime(620, t + 0.045);
    const mGain = this.ctx.createGain();
    mGain.gain.setValueAtTime(0.18, t + 0.012);
    mGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    mech.connect(mGain);
    mGain.connect(this.masterGain);
    mech.start(t + 0.012);
    mech.stop(t + 0.055);

    // Layer 4: Low-ammo mechanical warning ping (last 5 rounds in mag!)
    if (ammoRemaining <= 5) {
      const ping = this.ctx.createOscillator();
      ping.type = 'sine';
      ping.frequency.value = 2480 + (5 - ammoRemaining) * 190;
      const pG = this.ctx.createGain();
      pG.gain.setValueAtTime(0.11, t + 0.018);
      pG.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      ping.connect(pG);
      pG.connect(this.masterGain);
      ping.start(t + 0.018);
      ping.stop(t + 0.15);
    }
  }

  public playDryFire(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1900, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.025);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.035);
  }

  public playShellBounce(volume = 0.08): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 3800 + Math.random() * 950;
    for (const ratio of [1, 1.53, 2.31]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * ratio;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(volume / ratio, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.065);
      o.connect(g);
      g.connect(this.masterGain);
      o.start(t);
      o.stop(t + 0.07);
    }
  }

  public playReloadStep(step: 'mag_out' | 'mag_in' | 'bolt_slap' | 'click'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const g = this.ctx.createGain();

    if (step === 'mag_out') {
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.linearRampToValueAtTime(1800, t + 0.09);
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    } else if (step === 'mag_in') {
      bp.frequency.setValueAtTime(650, t);
      bp.frequency.linearRampToValueAtTime(1450, t + 0.06);
      g.gain.setValueAtTime(0.32, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    } else if (step === 'bolt_slap') {
      bp.frequency.setValueAtTime(2400, t);
      g.gain.setValueAtTime(0.38, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    } else {
      bp.frequency.setValueAtTime(3200, t);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    }
    bp.Q.value = 2.2;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);
    src.start(t);
    src.stop(t + 0.13);
  }

  public playFootstep(wetPuddle: number, sprinting: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = sprinting ? 0.16 : 0.09;

    // Boot heel thud
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(98 + Math.random() * 18, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.065);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    o.connect(g);
    g.connect(this.masterGain);
    o.start(t);
    o.stop(t + 0.08);

    // Wet splash if walking through floor puddle!
    if (wetPuddle > 0.35) {
      const sp = this.ctx.createBufferSource();
      sp.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 2600 + Math.random() * 700;
      hp.Q.value = 1.2;
      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(vol * wetPuddle * 0.85, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.095);
      sp.connect(hp);
      hp.connect(sg);
      sg.connect(this.masterGain);
      sp.start(t);
      sp.stop(t + 0.11);
    }
  }

  public playImpact(surface: SurfaceMaterialType, headshot = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    if (headshot || surface === 'enemy_head') {
      // Iconic helmet crack + high chime
      for (const f of [1680, 2940]) {
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.14);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.28, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        o.connect(g);
        g.connect(this.masterGain);
        o.start(t);
        o.stop(t + 0.17);
      }
      return;
    }

    if (surface === 'glass' || surface === 'light_fixture') {
      for (let i = 0; i < 4; i++) {
        const d = i * 0.022;
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 3100 + Math.random() * 2800;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.16, t + d);
        g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.09);
        o.connect(g);
        g.connect(this.masterGain);
        o.start(t + d);
        o.stop(t + d + 0.1);
      }
      return;
    }

    if (surface === 'metal' || surface === 'enemy_armor' || surface === 'steam_pipe' || surface === 'hazard_canister') {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      const base = 1150 + Math.random() * 850;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.45, t + 0.11);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = base * 1.4;
      bp.Q.value = 4.0;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.26, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      o.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      g.connect(this.reverbNode);
      o.start(t);
      o.stop(t + 0.14);
      return;
    }

    // Concrete impact thud
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
    src.start(t);
    src.stop(t + 0.08);
  }

  public playExplosion(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(92, t);
    sub.frequency.exponentialRampToValueAtTime(20, t + 0.65);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.95, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    sub.connect(sg);
    sg.connect(this.masterGain);
    sub.start(t);
    sub.stop(t + 0.72);

    const roar = this.ctx.createBufferSource();
    roar.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.9);
    const rg = this.ctx.createGain();
    rg.gain.setValueAtTime(0.85, t);
    rg.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
    roar.connect(lp);
    lp.connect(rg);
    rg.connect(this.masterGain);
    rg.connect(this.reverbNode);
    roar.start(t);
    roar.stop(t + 1.0);
  }

  public playEnemyShot(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1850, t);
    bp.frequency.exponentialRampToValueAtTime(480, t + 0.11);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.26, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);
    g.connect(this.reverbNode);
    src.start(t);
    src.stop(t + 0.14);
  }

  public playBulletWhiz(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(620, t + 0.085);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g);
    g.connect(this.masterGain);
    o.start(t);
    o.stop(t + 0.095);
  }
}
