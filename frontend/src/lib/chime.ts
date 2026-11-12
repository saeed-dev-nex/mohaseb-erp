let chimeContext: AudioContext | null = null;

/** Short, soft two-tone chime for real-time alerts. Best-effort only:
 * browsers may keep the context suspended until the user interacts.
 * (Same pattern as the chat chime in Layout.) */
export const playChime = () => {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    chimeContext = chimeContext || new Ctor();
    if (chimeContext.state === "suspended") void chimeContext.resume();
    const ctx = chimeContext;
    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.11;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  } catch {
    /* Sound is optional. */
  }
};
