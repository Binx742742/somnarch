/** Procedural dream-bed: drones, heartbeat, and stingers. No sample files. */

export class DreamAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private muted = false;
  private started = false;
  heart = 0;
  private heartAcc = 0;

  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ latencyHint: "interactive" });
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0.8;
      const music = ctx.createGain();
      music.gain.value = 0.9;
      const sfx = ctx.createGain();
      sfx.gain.value = 0.9;
      music.connect(master);
      sfx.connect(master);
      master.connect(ctx.destination);
      this.master = master;
      this.music = music;
      this.sfx = sfx;
      this.bed();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.started = true;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.03);
  }

  update(dt: number): void {
    if (!this.started || this.muted || !this.ctx) return;
    this.heartAcc += dt;
    const gap = 1.15 - this.heart * 0.86;
    if (this.heart > 0.08 && this.heartAcc >= gap) {
      this.heartAcc = 0;
      this.thump(70 + this.heart * 30, 0.12 + this.heart * 0.08);
    }
  }

  swing(): void {
    this.noise(180, 0.09, 0.08);
  }
  hit(): void {
    this.noise(90, 0.16, 0.2);
    this.tone(140, 0.12, "square", 0.05);
  }
  pick(): void {
    this.tone(660, 0.08, "sine", 0.05);
    this.tone(990, 0.12, "sine", 0.03);
  }
  lucid(): void {
    this.tone(392, 0.2, "sine", 0.06);
    this.tone(587, 0.28, "triangle", 0.04);
  }
  down(): void {
    this.tone(196, 0.3, "sawtooth", 0.04);
  }
  death(): void {
    this.noise(60, 0.35, 0.18);
    this.tone(90, 0.4, "sine", 0.06);
  }
  stun(): void {
    this.tone(880, 0.07, "square", 0.04);
    this.tone(440, 0.14, "square", 0.03);
  }
  win(): void {
    this.tone(523, 0.2, "sine", 0.05);
    this.tone(659, 0.28, "sine", 0.05);
    this.tone(784, 0.4, "triangle", 0.04);
  }
  lose(): void {
    this.tone(220, 0.4, "sine", 0.06);
    this.tone(110, 0.6, "triangle", 0.05);
  }
  foot(): void {
    this.noise(240, 0.04, 0.03);
  }
  veil(): void {
    this.tone(520, 0.18, "sine", 0.03);
    this.tone(780, 0.28, "triangle", 0.02);
  }
  ward(): void {
    this.tone(392, 0.22, "sine", 0.05);
    this.tone(523, 0.34, "triangle", 0.04);
    this.tone(659, 0.42, "sine", 0.03);
  }
  snuff(): void {
    this.tone(146, 0.28, "sawtooth", 0.04);
    this.noise(80, 0.2, 0.08);
  }
  stitch(): void {
    this.noise(140, 0.1, 0.12);
    this.tone(196, 0.16, "square", 0.04);
  }
  listen(): void {
    this.tone(466, 0.16, "sine", 0.035);
    this.tone(698, 0.28, "triangle", 0.02);
  }
  commit(): void {
    this.tone(98, 0.22, "sawtooth", 0.05);
    this.tone(73, 0.38, "square", 0.03);
  }
  door(broken: boolean): void {
    if (broken) {
      this.noise(90, 0.18, 0.16);
      this.tone(92, 0.22, "sawtooth", 0.05);
    } else {
      this.noise(160, 0.05, 0.09);
      this.tone(110, 0.07, "square", 0.04);
      this.noise(90, 0.09, 0.06);
    }
  }

  private bed(): void {
    const ctx = this.ctx;
    const music = this.music;
    if (!ctx || !music) return;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 280;
    filter.connect(music);
    for (const freq of [49, 73.4, 110]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.value = freq < 60 ? 0.045 : 0.02;
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
    }
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 420;
    band.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.015;
    noise.connect(band);
    band.connect(ng);
    ng.connect(music);
    noise.start();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number): void {
    if (!this.ctx || !this.sfx || this.muted || !this.started) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  private noise(freq: number, dur: number, vol: number): void {
    if (!this.ctx || !this.sfx || this.muted || !this.started) return;
    const ctx = this.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfx);
    src.start();
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private thump(freq: number, dur: number): void {
    this.tone(freq, dur, "sine", 0.05 + this.heart * 0.04);
  }
}
