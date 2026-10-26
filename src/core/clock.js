// Footer clock: "HH-HH:MM" = Hanoi hour, Los Angeles hour, shared minutes (the zones are whole hours apart),
// plus the LA zone label (PDT/PST) straight from the browser's time zone data, so DST switches itself.

const fmtHanoi = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtLA = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtZone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' });

const part = (fmt, date, type) => {
  const p = fmt.formatToParts(date).find((x) => x.type === type);
  return p ? p.value : '';
};

/** All clock strings for one instant. Pure, so it can be tested in Node. */
export function clockParts(date = new Date()) {
  const h = part(fmtHanoi, date, 'hour');
  const m = part(fmtHanoi, date, 'minute');
  const l = part(fmtLA, date, 'hour');
  return {
    time: `${h}-${l}:${m}`,
    zone: part(fmtZone, date, 'timeZoneName'),
    hanoi: `${h}:${m}`,
    la: `${l}:${m}`,
  };
}

/** Starts the live clock on every [data-clock] element; ticks on each minute boundary. */
export function startClock() {
  let timer = 0;
  const set = (sel, text) => document.querySelectorAll(sel).forEach((el) => {
    if (el.textContent !== text) el.textContent = text;
  });
  const tick = () => {
    clearTimeout(timer);
    const now = new Date();
    const p = clockParts(now);
    set('[data-clock="time"]', p.time);
    set('[data-clock="zone"]', p.zone);
    document.querySelectorAll('.footer_clock').forEach((el) => el.setAttribute('title', `Hanoi ${p.hanoi} · Los Angeles ${p.la} ${p.zone}`));
    // Align to the next minute boundary (+20 ms so the formatter is safely past it), then repeat every minute.
    timer = setTimeout(tick, 60000 - (now.getTime() % 60000) + 20);
  };
  tick();
  // Background tabs throttle timers; re-sync whenever the page becomes visible again.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) tick(); });
  return tick;
}
