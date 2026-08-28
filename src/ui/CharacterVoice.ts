import { publicPath } from "../publicPath";
import { VOICES, speechBank, speechRate, type VoiceId, type VoiceProfile } from "../data/voices";

const MASTER = 0.7;
/** Во сколько раз реже слога у речи NPC (длительность/тон слога не меняются). */
const SPEECH_BLIP_SPACING = 1;

/**
 * Бормотание из нарезанной человеческой речи; у кота — мультяшное «мяу» (не живой кот и не TTS).
 */
class CharacterVoice {
  private ctx: AudioContext | null = null;
  private maleBuf: AudioBuffer | null = null;
  private femaleBuf: AudioBuffer | null = null;
  private meowBuf: AudioBuffer | null = null;
  private loading = false;
  private profile: VoiceProfile | null = null;
  private enabled = false;
  private unlocked = false;
  private nextBlipAt = 0;
  private inWord = false;
  /** Когда текущее мяу доиграет (AudioContext.currentTime). */
  private meowEndAt = 0;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
    else void this.ctx?.resume();
  }

  unlock(): void {
    this.unlocked = true;
    const ctx = this.ensureCtx();
    void ctx?.resume();
    if (ctx) this.loadSamples(ctx);
  }

  speak(id: VoiceId): void {
    this.stop();
    this.profile = VOICES[id];
    this.nextBlipAt = 0;
    this.inWord = false;
    if (!this.enabled || !this.unlocked || !this.profile) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    void ctx.resume();
    this.loadSamples(ctx);
  }

  /** Вызывать на каждый напечатанный символ: слог на буквах, пауза только на пунктуации. */
  tick(ch: string): void {
    const profile = this.profile;
    if (!profile || !this.enabled || !this.unlocked) return;
    if (!isWordChar(ch)) {
      // Кот: каждое «мяу» — отдельное слово. Остальные — пауза только на пунктуации.
      if (profile.kind === "meow" || isPausePunct(ch)) this.inWord = false;
      return;
    }
    if (profile.kind === "meow") {
      if (this.inWord) return;
      this.inWord = true;
      this.blip();
      return;
    }
    this.inWord = true;
    if (!isVowel(ch) && Math.random() > 0.2) return;
    const now = performance.now();
    if (now < this.nextBlipAt) return;
    this.blip();
    this.nextBlipAt = now + profile.intervalMs * SPEECH_BLIP_SPACING * (0.68 + Math.random() * 0.55);
  }

  stop(): void {
    this.profile = null;
    this.inWord = false;
    this.nextBlipAt = 0;
  }

  private ensureCtx(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  private loadSamples(ctx: AudioContext): void {
    if (this.loading || (this.maleBuf && this.femaleBuf && this.meowBuf)) return;
    this.loading = true;
    void Promise.all([
      this.fetchBuf(ctx, "assets/audio/mumble-male.wav").then((b) => {
        this.maleBuf = b;
      }),
      this.fetchBuf(ctx, "assets/audio/mumble-female.wav").then((b) => {
        this.femaleBuf = b;
      }),
      this.fetchBuf(ctx, "assets/audio/meow.wav").then((b) => {
        this.meowBuf = b;
      }),
    ]).catch(() => {
      this.loading = false;
    });
  }

  private async fetchBuf(ctx: AudioContext, path: string): Promise<AudioBuffer> {
    const res = await fetch(publicPath(path));
    const arr = await res.arrayBuffer();
    return ctx.decodeAudioData(arr.slice(0));
  }

  private blip(): void {
    const profile = this.profile;
    const ctx = this.ctx;
    if (!profile || !ctx || ctx.state === "suspended") return;
    if (profile.kind === "meow") this.blipMeow(ctx, profile);
    else this.blipSpeech(ctx, profile);
  }

  private blipSpeech(ctx: AudioContext, profile: VoiceProfile): void {
    const buf = speechBank(profile.pitch) === "female" ? this.femaleBuf : this.maleBuf;
    if (!buf || buf.duration < 0.2) return;

    const t0 = ctx.currentTime;
    const rate = speechRate(profile.pitch) * (0.96 + Math.random() * 0.08);
    const dur = (profile.durMs / 1000) * (0.88 + Math.random() * 0.22);
    const grain = Math.min(dur / rate, buf.duration * 0.35);
    const offset = pickVowelOffset(buf, grain);
    const attack = 0.016;
    const release = Math.min(0.08, dur * 0.4);
    const peak = MASTER * (0.82 + Math.random() * 0.22);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;

    const hipass = ctx.createBiquadFilter();
    hipass.type = "highpass";
    hipass.Q.value = 0.5;
    hipass.frequency.value = 260;

    const mouth = ctx.createBiquadFilter();
    mouth.type = "lowpass";
    mouth.Q.value = 0.85;
    mouth.frequency.value = 1350 + profile.pitch * 420;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attack);
    env.gain.linearRampToValueAtTime(peak * 0.88, t0 + Math.max(attack + 0.02, dur - release));
    env.gain.linearRampToValueAtTime(0, t0 + dur);

    src.connect(hipass);
    hipass.connect(mouth);
    mouth.connect(env);
    env.connect(ctx.destination);
    src.start(t0, offset, grain + 0.03);
    src.stop(t0 + dur + 0.04);
    src.onended = () => {
      src.disconnect();
      hipass.disconnect();
      mouth.disconnect();
      env.disconnect();
    };
  }

  /** Сколько мс осталось до конца текущего мяу (0, если уже тишина). */
  remainMeowMs(): number {
    const ctx = this.ctx;
    if (!ctx || this.meowEndAt <= 0) return 0;
    return Math.max(0, (this.meowEndAt - ctx.currentTime) * 1000);
  }

  private blipMeow(ctx: AudioContext, _profile: VoiceProfile): void {
    const buf = this.meowBuf;
    if (!buf || buf.duration < 0.08) return;
    const rate = 0.92 + Math.random() * 0.16;
    const detune = (Math.random() * 2 - 1) * 90;
    const dur = buf.duration / (rate * 2 ** (detune / 1200));
    const t0 = Math.max(ctx.currentTime, this.meowEndAt);
    const attack = 0.008;
    const release = 0.03;
    const peak = MASTER * 0.7 * (0.88 + Math.random() * 0.12);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.detune.value = detune;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attack);
    env.gain.setValueAtTime(peak, t0 + Math.max(attack, dur - release));
    env.gain.linearRampToValueAtTime(0, t0 + dur);

    src.connect(env);
    env.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
    src.onended = () => {
      src.disconnect();
      env.disconnect();
    };
    this.meowEndAt = t0 + dur;
  }
}

export const characterVoice = new CharacterVoice();

function isWordChar(ch: string): boolean {
  return /\p{L}|\p{N}/u.test(ch);
}

function isDash(ch: string): boolean {
  return ch === "—" || ch === "–";
}

/** Пауза в речи: точка, запятая, тире, вопрос, восклицание (и близкие знаки). */
function isPausePunct(ch: string): boolean {
  return /[,.;:!?…]/.test(ch) || isDash(ch);
}

function isVowel(ch: string): boolean {
  return /[аеёиоуыэюяaeiouy]/i.test(ch);
}

/** Чем выше — тем больше резких согласных в куске записи. */
function grainHarshness(buf: AudioBuffer, offsetSec: number, grainSec: number): number {
  const data = buf.getChannelData(0);
  const start = Math.max(0, Math.floor(offsetSec * buf.sampleRate));
  const end = Math.min(data.length, start + Math.floor(grainSec * buf.sampleRate));
  if (end - start < 8) return 1;
  let crossings = 0;
  let prev = data[start] ?? 0;
  for (let i = start + 1; i < end; i++) {
    const sample = data[i] ?? 0;
    if ((prev >= 0 && sample < 0) || (prev < 0 && sample >= 0)) crossings++;
    prev = sample;
  }
  return crossings / (end - start);
}

function pickVowelOffset(buf: AudioBuffer, grain: number): number {
  const maxStart = Math.max(0, buf.duration - grain - 0.02);
  if (maxStart <= 0) return 0;
  let best = Math.random() * maxStart;
  let bestHarsh = grainHarshness(buf, best, grain);
  const tries = Math.random() < 0.18 ? 2 : 6;
  for (let i = 1; i < tries; i++) {
    const offset = Math.random() * maxStart;
    const harsh = grainHarshness(buf, offset, grain);
    if (harsh < bestHarsh) {
      best = offset;
      bestHarsh = harsh;
    }
  }
  return best;
}

/** Пауза на пунктуации. У NPC пробелы без паузы; у кота ждём, пока доиграет каждое «мяу». */
export function pauseAfterChar(
  text: string,
  index: number,
  baseDelay: number,
  intervalMs: number,
  voice?: VoiceId,
): number {
  const ch = text[index] ?? "";
  const prev = text[index - 1] ?? "";
  const next = text[index + 1] ?? "";
  const tempo = Math.max(0.85, Math.min(intervalMs, 115) / 100);

  let wait = baseDelay;
  if (/\s/.test(ch)) wait = 0;
  if (ch === "." && next === ".") wait = 0;
  else if (isDash(next)) wait = baseDelay + Math.round(200 * tempo);
  else if (ch === "…" || (ch === "." && prev === ".")) wait = baseDelay + Math.round(180 * tempo);
  else if (/[,;:]/.test(ch) || isDash(ch)) wait = baseDelay + Math.round(57 * tempo);
  else if (/[.!?]/.test(ch)) wait = baseDelay + Math.round(150 * tempo);

  if (voice === "cat" && !isWordChar(ch)) {
    const remain = Math.ceil(characterVoice.remainMeowMs());
    if (remain > 0) wait = Math.max(wait, remain + 40);
    else if (/\s/.test(ch)) wait = Math.max(wait, baseDelay + 80);
  }
  return wait;
}

/**
 * Печать текста с бормотанием. Возвращает отмену (стоп голоса и таймера).
 */
export function typeWithVoice(
  el: HTMLElement,
  text: string,
  voice: VoiceId,
  onDone: () => void,
  delay: number,
): () => void {
  characterVoice.speak(voice);
  const intervalMs = VOICES[voice].intervalMs;
  let shown = 0;
  let timer = 0;
  const step = (): void => {
    if (shown >= text.length) {
      characterVoice.stop();
      onDone();
      return;
    }
    const ch = text[shown]!;
    shown++;
    el.textContent = text.slice(0, shown);
    characterVoice.tick(ch);
    if (shown >= text.length) {
      characterVoice.stop();
      onDone();
      return;
    }
    timer = window.setTimeout(step, pauseAfterChar(text, shown - 1, delay, intervalMs, voice));
  };
  timer = window.setTimeout(step, 0);
  return () => {
    window.clearTimeout(timer);
    characterVoice.stop();
  };
}

/** Печать без голоса (UI, знаки препинания). */
export function typeText(
  el: HTMLElement,
  text: string,
  onDone: () => void,
  delay: number,
): () => void {
  let shown = 0;
  el.textContent = "";
  let timer = 0;
  const step = (): void => {
    if (shown >= text.length) {
      onDone();
      return;
    }
    shown++;
    el.textContent = text.slice(0, shown);
    timer = window.setTimeout(step, delay);
  };
  timer = window.setTimeout(step, 0);
  return () => window.clearTimeout(timer);
}

export function isPunctuationOnly(text: string): boolean {
  return text.length > 0 && !/\p{L}|\p{N}/u.test(text);
}
