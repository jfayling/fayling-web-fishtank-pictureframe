// On-screen clock, placed and styled the same way as fayling-web-ocean-pictureframe.
export function createClock(root, cfg) {
  const timeEl = root.querySelector('.clock-time');
  const dateEl = root.querySelector('.clock-date');

  function update() {
    const clock = cfg.clock;
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: clock.seconds ? '2-digit' : undefined,
      hour12: !clock.hour24,
    });
    dateEl.textContent = clock.date
      ? now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
      : '';
    root.dateTime = now.toISOString();
  }

  function place() {
    const position = cfg.clock.position;
    root.style.top = root.style.right = root.style.bottom = root.style.left = root.style.transform = '';
    const edge = '32px';
    if (position.startsWith('top')) root.style.top = position === 'top-right' ? '58px' : edge;
    else root.style.bottom = edge;
    if (position.endsWith('left')) root.style.left = edge;
    else if (position.endsWith('right')) root.style.right = edge;
    else {
      root.style.left = '50%';
      root.style.transform = 'translateX(-50%)';
    }
  }

  function apply() {
    const clock = cfg.clock;
    root.hidden = !clock.enabled;
    root.dataset.style = clock.style;
    root.style.fontSize = clock.size + 'px';
    root.style.color = clock.color;
    root.style.opacity = String(clock.opacity);
    root.style.backgroundColor = `rgba(11, 15, 20, ${clock.background})`;
    root.style.textShadow = clock.background < 0.35 ? '0 2px 8px #000c' : 'none';
    place();
    update();
  }

  const timer = setInterval(update, 250);
  return { apply, stop() { clearInterval(timer); } };
}
