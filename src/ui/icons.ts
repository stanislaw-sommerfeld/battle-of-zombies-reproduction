// Small inline SVG icons for the ability bar. Unicode symbols render
// inconsistently across system fonts, SVG always does.
const svg = (body: string) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  light: svg(`<path d="M5 19 17 7l2-4-4 2L3 17"/><path d="m7 15 2 2"/><path d="M4 20l2-2"/>`),
  heavy: svg(`<path d="M14 4h6v5l-3 1-3-3z" fill="currentColor" fill-opacity=".25"/><path d="M15.5 8.5 4 20"/><path d="M14 4h6v5l-3 1-3-3z"/>`),
  dodge: svg(`<path d="M4 7h9"/><path d="M2 12h12"/><path d="M4 17h9"/><path d="m15 6 6 6-6 6"/>`),
  fire: svg(`<path d="M12 21c-4 0-6-3-6-6 0-4 4-6 3-11 3 2 5 5 5 8 1-1 2-2 2-4 2 2 2 4 2 7 0 3-2 6-6 6z" fill="currentColor" fill-opacity=".3"/><path d="M12 21c-1.5 0-2.5-1-2.5-2.5S12 15 12 14c1 1 2.5 2.5 2.5 4.5S13.5 21 12 21z"/>`),
  frost: svg(`<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2M4 10.5l1-3.5-3.5-1M20 13.5l-1 3.5 3.5 1M4 13.5 5 17l-3.5 1M20 10.5 19 7l3.5-1"/>`),
  flask: svg(`<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9" /><path d="M7 18h10l-1.5-3h-7z" fill="currentColor" fill-opacity=".35" stroke="none"/>`),
  eat: svg(`<path d="M4 13c0-5 4-8 8-8s8 3 8 8v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".2"/><path d="M8 10l1 2M12 9v2.5M16 10l-1 2"/>`),
  empty: svg(`<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>`),
};
