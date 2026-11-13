// Looping background music, deployed next to the page as media/track001.mp3.
// loop restarts the file at the end; the ended handler covers players that ignore the loop flag.
// Browsers only allow playback after a gesture, so a saved "on" starts on the next click or key.
// The music button handles its own gesture, so a press that turns music off is not also a resume.

export function createSoundtrack(initial = {}, report = () => {}) {
  const soundtrack = new Audio('media/track001.mp3');
  soundtrack.loop = true;
  soundtrack.preload = 'auto';
  soundtrack.hidden = true;
  document.body.append(soundtrack);

  let enabled = !!initial.enabled;
  let volume = clampPercent(initial.volume);
  let musicErrorLogged = false;

  function play() {
    const pending = soundtrack.play();
    if (!pending) return;
    pending.catch((err) => {
      if (err && err.name === 'NotAllowedError') return;
      if (musicErrorLogged) return;
      musicErrorLogged = true;
      report('music: ' + (err && err.message ? err.message : err));
    });
  }

  function applyVolume() {
    soundtrack.volume = Math.min(1, Math.max(0, volume / 100));
  }

  function applyState() {
    applyVolume();
    if (!enabled) {
      soundtrack.pause();
      return;
    }
    play();
  }

  soundtrack.addEventListener('ended', () => {
    if (!enabled) return;
    soundtrack.currentTime = 0;
    play();
  });
  soundtrack.addEventListener('error', () => {
    if (musicErrorLogged) return;
    musicErrorLogged = true;
    report('music: could not load media/track001.mp3');
  });

  function resume(event) {
    if (event.target instanceof Element && event.target.closest('#music')) return;
    if (enabled && soundtrack.paused) play();
  }
  addEventListener('pointerdown', resume);
  addEventListener('keydown', resume);

  applyState();

  return {
    apply(next = {}) {
      enabled = !!next.enabled;
      volume = clampPercent(next.volume);
      applyState();
    },
  };
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, n));
}
