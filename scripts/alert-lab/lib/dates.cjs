'use strict';
// Locale date rendering. Every style carries its own label semantics: the
// ground-truth date is the ISO calendar day the text names, with 2026 assumed
// when the style omits the year (all generated activity is in Sep-Oct 2026).
const pad = (n) => String(n).padStart(2, '0');

/** Date styles by id. `lang` supplies month names and time words. */
const STYLES = {
  'mdy-slash': (d, L) => `${pad(d.m)}/${pad(d.d)}/${d.y}`,
  'md-slash': (d) => `${d.m}/${d.d}`,
  'mon-d-y': (d, L) => `${L.months[d.m - 1]} ${d.d}, ${d.y}`,
  'mon-d': (d, L) => `${L.months[d.m - 1]} ${d.d}`,
  'dmy-slash': (d) => `${pad(d.d)}/${pad(d.m)}/${d.y}`,
  'dmy2-slash': (d) => `${pad(d.d)}/${pad(d.m)}/${String(d.y).slice(2)}`,
  'dm-slash': (d) => `${pad(d.d)}/${pad(d.m)}`,
  'd-mon-y': (d, L) => `${d.d} ${L.months[d.m - 1]} ${d.y}`,
  'd-mon': (d, L) => `${d.d} ${L.months[d.m - 1]}`,
  'dd-Mon-yyyy': (d, L) => `${pad(d.d)}-${L.monthsEn[d.m - 1]}-${d.y}`,
  'dmy-dot': (d) => `${pad(d.d)}.${pad(d.m)}.${d.y}`,
  'dm-dot': (d) => `${pad(d.d)}.${pad(d.m)}.`,
  'd.-mon-y': (d, L) => `${d.d}. ${L.months[d.m - 1]} ${d.y}`,
  'd. m. y': (d) => `${d.d}. ${d.m}. ${d.y}`,
  'dmy-dash': (d) => `${pad(d.d)}-${pad(d.m)}-${d.y}`,
  iso: (d) => `${d.y}-${pad(d.m)}-${pad(d.d)}`,
};

/** Times by id; each language picks which ones it uses. */
const TIMES = {
  none: () => '',
  'at-12h': (d, L) => ` ${L.at12 ?? 'at'} ${((d.h + 11) % 12) + 1}:${pad(d.min)} ${d.h < 12 ? 'AM' : 'PM'}`,
  'at-24h': (d, L) => ` ${L.at24 ?? 'at'} ${pad(d.h)}:${pad(d.min)}`,
  '24h': (d) => ` ${pad(d.h)}:${pad(d.min)}`,
  'de-uhr': (d) => ` um ${pad(d.h)}:${pad(d.min)} Uhr`,
  'fr-h': (d) => ` à ${pad(d.h)}h${pad(d.min)}`,
};

const iso = (d) => `${d.y}-${pad(d.m)}-${pad(d.d)}`;

function formatDate(d, styleId, timeId, L) {
  const style = STYLES[styleId];
  if (!style) throw new Error(`unknown date style ${styleId}`);
  const time = TIMES[timeId] ?? TIMES.none;
  return style(d, L) + time(d, L);
}

module.exports = { formatDate, iso, STYLES, TIMES };
