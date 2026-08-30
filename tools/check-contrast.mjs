// Contrast gate for the GoodFolder palette.
//
// Every pair below is a real combination the product paints: the flattened
// value of a token over the surface it actually appears on. Keep this list in
// step with apps/web/app/globals.css — the point is to catch a token change
// that quietly drops small text under 4.5:1.
//
//   #2C60B6  --gf-blue-ink       blue 74% + black
//   #616161  --gf-ink-soft       black 62% on white
//   #707070  --gf-ink-faint      black 56% on white
//   #F9FBFF  --gf-surface-sunken blue 3% on white
//   #F7FAFF  --gf-blue-wash      blue 4% on white
//   #F3F8FE  window toolbar      white 94% + blue
//   #E6ECF6  white 88% flattened on --gf-blue-ink (a selected row's subtext)
//   #BDBDBD  --gf-on-dark        white 74% on black
//   #949494  --gf-on-dark-faint  white 58% on black

const pairs = [
  ["primary button text", "#FFFFFF", "#2C60B6", 4.5],
  ["blue accent on white", "#2C60B6", "#FFFFFF", 4.5],
  ["blue accent on tinted surface", "#2C60B6", "#F9FBFF", 4.5],
  ["black label on canonical blue", "#000000", "#3B82F6", 4.5],
  ["supporting text on white", "#616161", "#FFFFFF", 4.5],
  ["supporting text on tinted surface", "#616161", "#F9FBFF", 4.5],
  ["metadata text on white", "#707070", "#FFFFFF", 4.5],
  ["metadata text on tinted surface", "#707070", "#F9FBFF", 4.5],
  ["metadata text on blue wash", "#707070", "#F7FAFF", 4.5],
  ["body text on dark panel", "#BDBDBD", "#000000", 4.5],
  ["quiet text on dark panel", "#949494", "#000000", 4.5],
  ["blue icon on dark panel", "#3B82F6", "#000000", 3],
  // The window: a selected row is white on the accessible blue, and the
  // toolbar sits on a barely-tinted white that metadata text still has to
  // read against.
  ["selected row text", "#FFFFFF", "#2C60B6", 4.5],
  ["selected row secondary text", "#E6ECF6", "#2C60B6", 4.5],
  ["toolbar text on window chrome", "#616161", "#F3F8FE", 4.5],
  ["toolbar metadata on window chrome", "#707070", "#F3F8FE", 4.5],
];

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255);
  const linear = rgb.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

let failed = false;
for (const [label, foreground, background, minimum] of pairs) {
  const actual = ratio(foreground, background);
  const result = actual >= minimum ? "✓" : "✗";
  console.log(`contrast: ${label} ${actual.toFixed(2)}:1 (needs ${minimum}) ${result}`);
  if (actual < minimum) failed = true;
}
if (failed) process.exitCode = 1;
