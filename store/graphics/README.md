# Store graphics

Everything here is generated — never hand-edit the PNGs. Edit the HTML in `src/`
and re-run `./render.sh`.

The motif is an **eight-petal rosette** — a flower opening, for a word whose
root means both "to purify" and "to grow". Eight petals nod to the
eight-pointed geometry of mushaf ornament without reusing Daily Qur'an's Rub
el Hizb; the two apps share a palette and read as siblings. Colours come from
`src/lib/theme.ts`: deep indigo `#23417A` and manuscript gold `#AD8C36`
(rendered as a `#E4C87A → #9C7C2C` gradient so it reads as metal, not flat
yellow). `src/motif.svg` is the reference drawing.

## Outputs

| File | Size | Used for |
| --- | --- | --- |
| `play-icon-512.png` | 512×512, opaque | Play Console app icon (Play rejects alpha) |
| `feature-graphic-1024x500.png` | 1024×500 | Play Console feature graphic |
| `app-icon-1024.png` | 1024×1024, opaque | candidate replacement for `assets/images/icon.png` |
| `android-icon-foreground.png` | 512×512, alpha | adaptive-icon foreground |
| `android-icon-monochrome.png` | 432×432, alpha | themed-icon layer |
| `splash-icon.png` | 1024×1024, alpha | splash screen logo |
| `screenshots/*.png` | 1440×3120 | Play Console phone screenshots |

The bottom four are **shipped** — they were copied into `assets/images/` (see
"Icon swap" below) and the app no longer uses the stock Expo template icon.

## Adaptive icon safe zone

Android crops the foreground layer to the central 66/108 of the canvas. Petal
tips sit 144 from centre (plus half a 12px stroke), inside the 156px safe
radius, so nothing clips on a circular or squircle mask.

`icon.html` (full-bleed) draws the rosette larger — it is never masked, so it
can run to the edges.

## Icon swap

`render.sh` writes the four shipped files straight into `assets/images/`.
Run `npx expo prebuild -p android` afterwards to regenerate the native mipmaps.
`adaptiveIcon.backgroundColor` in `app.json` is `#23417A` to match.

Still template: `assets/expo.icon` (`expo.ios.icon`) and
`assets/images/favicon.png`. Neither ships on Android.

## Rendering

`render.sh` drives headless Chrome. Chrome is the rasteriser because this
machine has no `rsvg-convert`, ImageMagick, or Pillow, and `sips` cannot read
SVG.
