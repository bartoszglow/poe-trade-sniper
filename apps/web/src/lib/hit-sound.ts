/**
 * Hit alert sound — synthesized (no asset), two quick rising tones.
 * Browsers gate audio behind a user gesture; the Settings "test" button
 * doubles as the unlock.
 */
const SOUND_STORAGE_KEY = 'sniper.hitSound';

export function isHitSoundEnabled(): boolean {
  return localStorage.getItem(SOUND_STORAGE_KEY) !== '0';
}

export function setHitSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_STORAGE_KEY, enabled ? '1' : '0');
}

let audioContext: AudioContext | null = null;

export function playHitSound(): void {
  try {
    audioContext ??= new AudioContext();
    const startAt = audioContext.currentTime;
    const tones: Array<[number, number]> = [
      [0, 880],
      [0.12, 1320],
    ];
    for (const [offsetSeconds, frequency] of tones) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, startAt + offsetSeconds);
      gain.gain.exponentialRampToValueAtTime(0.18, startAt + offsetSeconds + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offsetSeconds + 0.12);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(startAt + offsetSeconds);
      oscillator.stop(startAt + offsetSeconds + 0.14);
    }
  } catch {
    // Audio not unlocked yet — silently skip; the hit still shows visually.
  }
}
