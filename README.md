# Kokky Voucher Generator — candy design (v2)

A standalone copy of the original coupon generator, restyled to the candy
artwork. xlsx/csv import, gift and discount vouchers, Code 128 barcodes, two
print sizes, the live HTML review page, and the CLI path all work as before.

Runs on **port 3001** by default so it can sit alongside the original
generator on port 3000.

## Running it

```bash
cd coupon-gen-v2
npm install          # only needed if node_modules is missing
npm start            # http://localhost:3001
```

Playwright's Chromium is shared with the v1 project, so if v1 already works
there is nothing extra to install. If it complains, run
`npx playwright install chromium`.

CLI, same as before:

```bash
node render_pdf.js coupons.json output.pdf
```

## The artwork is untouched

`assets/bg.png` is the supplied Illustrator PDF rendered at 600dpi and cropped
to its bounding box. **Nothing has been painted out or redrawn.** Every fixed
element is exactly as designed:

| Part of `bg.png` (never changes) | Generated on top |
|---|---|
| Candy pattern, red strip, dashed cut line | Gift value / discount text (rotated on the strip) |
| White card and its navy outline | Validity date (inside the yellow bar) |
| Kokky logo | Barcode |
| "Gift Voucher" title | Human-readable code |
| **Terms & Conditions — heading and all body text** | |
| Yellow bar | |

Because the terms are printed as part of the design, there is no Terms box on
the form and no terms-related layout controls. To change the wording, edit the
Illustrator file and rebuild `bg.png` (see below).

**Both voucher types show the same "Gift Voucher" title** — it is part of the
artwork. The only difference between them is the red strip: gift vouchers show
the value (`MVR 350`), discount vouchers show the discount text (`20% OFF`).

## How the layout works

The old template used a three-column mm-based grid. This one anchors every
element **absolutely, in percentages of the coupon box**. The artwork has a
locked aspect ratio of 2.2217 (197.23 × 88.77 mm), so the same percentages are
correct at any print size — `small` and `large` differ only in the value of
`--cw`, the coupon width. Font sizes are `calc(var(--cw) * fraction)` and scale
with it.

All anchors live in one `:root` block at the top of `template.html`:

| Variable | Value | What it pins |
|---|---|---|
| `--strip-w` | 17.5% | Red strip width |
| `--bar-l` … `--bar-b` | 30.50–53.73%, 62.71–70.14% | Yellow bar (validity date) |
| `--barcode-l` … `--barcode-b` | 59.42–90%, 58–78.5% | Barcode block |
| `--fs-strip` | 0.0400 | Strip value size (7.89mm at large) |
| `--fs-validity` | 0.0170 | Validity date size (3.35mm at large) |
| `--fs-code` | 0.0150 | Code size (2.96mm at large) |
| `--stroke-strip` | 0.0045 | Navy outline on the strip value (0.89mm at large) |

### Strip value styling

White fill with a chunky navy outline, matching the Kokky logo's lettering.
`paint-order: stroke fill` keeps the stroke behind the fill, so the white stays
at full weight and the outline grows outwards rather than eating into the
letterforms. Thickness is adjustable via `stripStrokeWidth`.

### Auto-fit

`autoFitText()` in `render_pdf.js` is inlined into every generated page and
runs once the embedded fonts are ready. It shrinks — never grows — any text
that would spill out of its box, down to a floor of 55%:

- validity date vs the yellow bar
- rotated strip value vs the strip length
- code vs the barcode width

If something hits the 55% floor it is genuinely too long and should be
shortened by hand.

### Date format

Validity renders as `22 Feb 2026`, not `February 22, 2026`. The yellow bar is
only 23.2% of the coupon width; the long form forces the type down to ~2.7mm
at print size where the short form sits comfortably at ~3.4mm. Change `month`
to `"long"` in `formatDisplayDate` if you prefer the full name.

## Sizes

| Size | Coupon | Per A4 page |
|---|---|---|
| `small` | 100 × 45.02 mm | 12 (2 × 6) |
| `large` | 197.23 × 88.77 mm | 3 |

## Fonts

- **Bestime** (`assets/Voucher fonts/Bestime.ttf`) — the artwork's display font
- **Skynight** (`assets/Voucher fonts/Skynight.otf`) — the artwork's body font

Both are embedded in every generated page, so either can be chosen for any of
the three generated elements via the font pickers. Only names in
`FONT_FAMILIES` are ever emitted into CSS — anything else is ignored, so a
malformed value cannot break the stylesheet.

## Micro-adjustments

15 controls, grouped by element. They appear as **number-only boxes** on the
main form, and on the review page as a **slider paired with a number box** so
you can either drag roughly or type an exact value — the two stay in sync.
Distances are mm; negative moves up or left. Blank means "use the default".

**Gift value / discount text (red strip)**

| Key | Default | Effect |
|-----|---------|--------|
| `stripShiftVertical` | 0 | Move along the strip |
| `stripShiftHorizontal` | 0 | Move across the strip |
| `stripFontSize` | 7.89mm | Text size |
| `stripStrokeWidth` | 0.89mm | Navy outline thickness |
| `stripFontFamily` | Bestime | Font |

**Validity date (yellow bar)**

| Key | Default | Effect |
|-----|---------|--------|
| `validityShiftDown` | 0 | Move up / down |
| `validityShiftHorizontal` | 0 | Move left / right |
| `validityFontSize` | 3.35mm | Text size |
| `validityFontFamily` | Bestime | Font |

**Barcode & code**

| Key | Default | Effect |
|-----|---------|--------|
| `barcodeShiftDown` | 0 | Move up / down |
| `barcodeShiftHorizontal` | 0 | Move left / right |
| `barcodeWidth` | 60.3mm | Barcode width |
| `barcodeHeight` | 14.5mm | Barcode height (opts the bar out of flex stretch) |
| `codeFontSize` | 2.96mm | Code text size |
| `codeFontFamily` | Skynight | Code font |

Defaults shown are at `large`; they scale proportionally at `small`.

`LAYOUT_KEYS` in `render_pdf.js` is the single source of truth — the fields in
`public/index.html` and the controls in `public/review.html` must stay in sync
with it. `RAW_LAYOUT_KEYS` marks the values that are passed through without
`mm` being appended (currently the three font pickers).

They also work from the CLI:

```json
{
  "size": "large",
  "layout": { "stripStrokeWidth": "1.2mm", "barcodeHeight": "12mm", "codeFontFamily": "Bestime" },
  "coupons": [ ... ]
}
```

## Regenerating the background

If the artwork changes, re-export it to PDF and rebuild `assets/bg.png`:

```bash
pdftoppm -r 600 -png "gift voucher_print_new.pdf" out
# then crop to the non-white bounding box and save as assets/bg.png
```

Keep the 2.2217 aspect ratio, or update `SIZES` in `render_pdf.js` to match.
If elements move within the design, re-measure and update the `:root` anchors.

## Known cosmetic difference

Strip text reads bottom-to-top. Swap `rotate(-90deg)` to `rotate(90deg)` in
`.strip-text` for top-to-bottom.
