/**
 * Гудки дозвона (КПВ): длинный тон и длинная пауза —
 * не «занято» и не сигнал конца звонка.
 */
class DialTone {
  private ctx: AudioContext | null = null;
  private enabled = false;
  private unlocked = false;
  private timer = 0;
  private playing = false;
  private hangupTimers: number[] = [];
  private hangupOscillators = new Set<OscillatorNode>();

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
  }

  unlock(): void {
    this.unlocked = true;
    void this.ensureCtx()?.resume();
  }

  start(): void {
    this.stop();
    this.playing = true;
    this.ring();
  }

  playHangup(): void {
    this.stop();
    if (!this.enabled || !this.unlocked) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    void ctx.resume();
    for (let i = 0; i < 4; i++) {
      const timer = window.setTimeout(() => {
        this.hangupTimers = this.hangupTimers.filter((id) => id !== timer);
        if (this.enabled && this.unlocked) this.hangupPulse(ctx);
      }, i * 340);
      this.hangupTimers.push(timer);
    }
  }

  stop(): void {
    this.playing = false;
    window.clearTimeout(this.timer);
    this.timer = 0;
    for (const timer of this.hangupTimers) window.clearTimeout(timer);
    this.hangupTimers = [];
    for (const osc of this.hangupOscillators) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this.hangupOscillators.clear();
  }

  private ensureCtx(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  private ring(): void {
    if (!this.playing) return;
    if (this.enabled && this.unlocked) {
      const ctx = this.ensureCtx();
      if (ctx) {
        void ctx.resume();
        // Двойной гудок дозвона: дззз — дззз … пауза (не короткие «пик-пик» конца звонка).
        this.pulse(ctx, 0);
        this.pulse(ctx, 0.55);
      }
    }
    this.timer = window.setTimeout(() => this.ring(), 2200);
  }

  private pulse(ctx: AudioContext, offsetSec: number): void {
    const t0 = ctx.currentTime + offsetSec;
    const dur = 0.4;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(0.14, t0 + 0.02);
    master.gain.setValueAtTime(0.14, t0 + dur - 0.05);
    master.gain.linearRampToValueAtTime(0, t0 + dur);
    master.connect(ctx.destination);

    // Два тона — привычный «телефонный» ringback, а не одиночный писк.
    for (const hz of [440, 480]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, t0);
      osc.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      osc.onended = () => osc.disconnect();
    }
    window.setTimeout(() => {
      try {
        master.disconnect();
      } catch {
        /* already stopped */
      }
    }, (offsetSec + dur + 0.05) * 1000);
  }

  private hangupPulse(ctx: AudioContext): void {
    const t0 = ctx.currentTime;
    const dur = 0.16;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
    master.gain.setValueAtTime(0.12, t0 + dur - 0.03);
    master.gain.linearRampToValueAtTime(0, t0 + dur);
    master.connect(ctx.destination);

    for (const hz of [425, 450]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, t0);
      osc.connect(master);
      this.hangupOscillators.add(osc);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      osc.onended = () => {
        this.hangupOscillators.delete(osc);
        osc.disconnect();
      };
    }
    window.setTimeout(() => {
      try {
        master.disconnect();
      } catch {
        /* already stopped */
      }
    }, (dur + 0.05) * 1000);
  }
}

export const dialTone = new DialTone();
