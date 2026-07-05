/**
 * Alert sounds — synthesized (no asset). Hits chirp two quick rising tones;
 * deals (plan 41) add a third rising tone at a slightly hotter peak — they are
 * time-critical, the operator asked for marked + louder. Both share the enable
 * toggle and stored volume. Browsers gate audio behind a user gesture; the
 * Settings "test" button doubles as the unlock.
 */
const SOUND_STORAGE_KEY = 'sniper.hitSound';
const VOLUME_STORAGE_KEY = 'sniper.hitSoundVolume';

/** Synth peak gain at 100 % volume — the loudness the app shipped with. */
const PEAK_GAIN = 0.18;
/** Deal chirp peak vs the hit chirp — capped at ×1.25, still volume-scaled. */
const DEAL_GAIN_RATIO = 1.25;

/** Tone schedule: [offsetSeconds, frequencyHz] pairs, played as one chirp. */
type ToneSchedule = ReadonlyArray<readonly [number, number]>;

const HIT_TONES: ToneSchedule = [
  [0, 880],
  [0.12, 1320],
];
const DEAL_TONES: ToneSchedule = [
  [0, 880],
  [0.12, 1320],
  [0.24, 1760],
];

export function isHitSoundEnabled(): boolean {
  return localStorage.getItem(SOUND_STORAGE_KEY) !== '0';
}

export function setHitSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_STORAGE_KEY, enabled ? '1' : '0');
}

/** Alert volume in percent (0–100). */
export function getHitSoundVolume(): number {
  const stored = Number(localStorage.getItem(VOLUME_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored < 0 || stored > 100) return 100;
  return Math.round(stored);
}

export function setHitSoundVolume(volumePercent: number): void {
  localStorage.setItem(VOLUME_STORAGE_KEY, String(Math.min(100, Math.max(0, volumePercent))));
}

let audioContext: AudioContext | null = null;

function playTones(tones: ToneSchedule, peakGain: number): void {
  try {
    const peak = peakGain * (getHitSoundVolume() / 100);
    if (peak <= 0) return;
    audioContext ??= new AudioContext();
    const startAt = audioContext.currentTime;
    for (const [offsetSeconds, frequency] of tones) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, startAt + offsetSeconds);
      gain.gain.exponentialRampToValueAtTime(peak, startAt + offsetSeconds + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offsetSeconds + 0.12);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(startAt + offsetSeconds);
      oscillator.stop(startAt + offsetSeconds + 0.14);
    }
  } catch {
    // Audio not unlocked yet — silently skip; the alert still shows visually.
  }
}

export function playHitSound(): void {
  playTones(HIT_TONES, PEAK_GAIN);
}

/** Deal alert: the hit chirp + a third rising tone, slightly louder (plan 41). */
export function playDealSound(): void {
  playTones(DEAL_TONES, PEAK_GAIN * DEAL_GAIN_RATIO);
}
