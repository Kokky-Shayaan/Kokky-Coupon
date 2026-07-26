/**
 * Kokky voucher renderer — candy design (v2)
 *
 * Same pipeline as v1: inline the background + fonts as data URIs, fill the
 * template placeholders, then let Playwright print it to A4.
 *
 * Differences from v1:
 *  - Fonts are Bestime and Skynight.
 *  - assets/bg.png is the Illustrator artwork UNMODIFIED. The "Gift Voucher"
 *    title, the "Terms & Conditions" heading AND the T&C body text are all
 *    part of that image, so none of them are generated here. Both voucher
 *    types show the same title; only the red strip text differs.
 *  - The validity date sits inside the yellow bar.
 *  - Positions in template.html are percentages of the coupon box, so the
 *    layout tweaks below nudge things with margins rather than a grid.
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const bwipjs = require("bwip-js");

/** Locked by the artwork: 197.23mm x 88.77mm. */
const ARTWORK_ASPECT = 2.2217;

/** Fonts offered in the per-element pickers. Must exist in assets/. */
const FONT_FAMILIES = ["Bestime", "Skynight"];

function toDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const mime =
    ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : "application/octet-stream";
  const b64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${b64}`;
}

function fontMime(ext) {
  return ext === ".woff2"
    ? "font/woff2"
    : ext === ".woff"
      ? "font/woff"
      : ext === ".ttf"
        ? "font/ttf"
        : ext === ".otf"
          ? "font/otf"
          : "application/octet-stream";
}

function fontFaceCss({ fontPath, family, weight = 400, style = "normal" }) {
  const ext = path.extname(fontPath).toLowerCase();
  const mime = fontMime(ext);
  const formatStr =
    ext === ".ttf"
      ? "truetype"
      : ext === ".otf"
        ? "opentype"
        : ext === ".woff"
          ? "woff"
          : ext === ".woff2"
            ? "woff2"
            : "";

  const b64 = fs.readFileSync(fontPath).toString("base64");
  return `
@font-face {
  font-family: "${family}";
  src: url("data:${mime};base64,${b64}") format("${formatStr}");
  font-weight: ${weight};
  font-style: ${style};
}
`;
}

/**
 * Bestime  = display font, used for the artwork's headings.
 * Skynight = body font, used for the artwork's terms text.
 * Both are embedded on every page so either can be picked for any element.
 */
function buildFontCss(assetDir) {
  const fontDefs = [
    {
      fontPath: path.join(assetDir, "Voucher fonts", "Bestime.ttf"),
      family: "Bestime",
      weight: 400,
    },
    {
      fontPath: path.join(assetDir, "Voucher fonts", "Skynight.otf"),
      family: "Skynight",
      weight: 400,
    },
  ];

  const missing = fontDefs.filter((f) => !fs.existsSync(f.fontPath));
  if (missing.length) {
    console.warn(
      "Missing font files (falling back to system fonts):",
      missing.map((f) => path.basename(f.fontPath)).join(", "),
    );
  }

  return fontDefs
    .filter((font) => fs.existsSync(font.fontPath))
    .map((font) => fontFaceCss(font))
    .join("\n");
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[c]);
}

function barcodeSvg(text) {
  return bwipjs.toSVG({
    bcid: "code128",
    text: String(text),
    scale: 2,
    height: 10,
    includetext: false,
  });
}

function isGiftVoucher(c) {
  const t = String(c.voucherType || "").toLowerCase();
  if (t === "gift") return true;
  // Defensive: gift-only payloads may omit voucherType but include giftValue
  if (t !== "discount" && c.giftValue && String(c.giftValue).trim()) return true;
  return false;
}

/**
 * Text for the red strip.
 * Gift     → the value, e.g. "MVR 350".
 * Discount → the discount line exactly as typed, e.g. "20% OFF".
 * Nothing is ever appended that you did not type.
 */
function stripTextForCoupon(c) {
  if (isGiftVoucher(c)) {
    const v = (c.giftValue || c.discountText || "").trim();
    return v || "MVR 0";
  }
  return (c.discountText || "").trim() || "15%";
}

/**
 * Compact by design: "22 Feb 2026", not "February 22, 2026".
 * The validity date has to sit inside the yellow bar, which is only 23.2% of
 * the coupon width — the long form forces the type down to ~2.7mm at print
 * size, the short form fits comfortably at ~3.4mm. Switch `month` to "long"
 * here if you would rather have the full month name and smaller text.
 */
function formatDisplayDate(inputDate = "") {
  const date = new Date(inputDate);
  if (Number.isNaN(date.getTime())) {
    return escapeHtml(String(inputDate));
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function buildPagesHtml(coupons, perPage) {
  const pages = [];
  for (let i = 0; i < coupons.length; i += perPage) {
    const chunk = coupons.slice(i, i + perPage);

    const couponBlocks = chunk
      .map((c) => {
        const gift = isGiftVoucher(c);
        const stripLine = stripTextForCoupon(c);
        const typeClass = gift ? "coupon--gift" : "coupon--discount";

        // Markup is identical for both types — the title and the whole terms
        // block are part of the artwork. Only the strip text differs.
        return `
      <div class="coupon ${typeClass}">
        <div class="bg"></div>
        <div class="layer">
          <div class="strip">
            <div class="strip-text">${escapeHtml(stripLine)}</div>
          </div>

          <div class="validity">Valid until ${formatDisplayDate(c.validUntil)}</div>

          <div class="barcode-block">
            <div class="barcode">${barcodeSvg(c.code)}</div>
            <div class="code">${escapeHtml(c.code)}</div>
          </div>
        </div>
      </div>
    `;
      })
      .join("");

    pages.push(`<div class="page">${couponBlocks}</div>`);
  }
  return pages.join("\n");
}

/**
 * Micro-adjustments. Every key is optional.
 *
 * Distance keys take mm strings ("3mm", "-2mm"). RAW_LAYOUT_KEYS are passed
 * through verbatim instead — currently the three font pickers. Positions are
 * nudged with margins because the template anchors everything absolutely in
 * percentages.
 */
const LAYOUT_KEYS = [
  // Red strip — gift value / discount text
  "stripShiftVertical",
  "stripShiftHorizontal",
  "stripFontSize",
  "stripStrokeWidth",
  "stripFontFamily",
  // Validity date inside the yellow bar
  "validityShiftDown",
  "validityShiftHorizontal",
  "validityFontSize",
  "validityFontFamily",
  // Barcode block
  "barcodeShiftDown",
  "barcodeShiftHorizontal",
  "barcodeWidth",
  "barcodeHeight",
  "codeFontSize",
  "codeFontFamily",
];

/** Keys sent as-is, with no "mm" appended. */
const RAW_LAYOUT_KEYS = new Set([
  "stripFontFamily",
  "validityFontFamily",
  "codeFontFamily",
]);

/** Only ever emit a font name we actually embed. */
function safeFontFamily(v) {
  const name = String(v || "").trim().replace(/^["']|["']$/g, "");
  return FONT_FAMILIES.includes(name) ? name : null;
}

function buildLayoutCss(layout, size) {
  if (!layout || typeof layout !== "object") {
    return "";
  }
  const b = `body.size-${size}`;
  const rules = [];
  const n = (v) => (v != null && v !== "" ? String(v).trim() : null);

  // --- Red strip text (rotated, so margins read as on-screen directions) ---
  const stripV = n(layout.stripShiftVertical);
  if (stripV) rules.push(`${b} .strip-text { margin-top: ${stripV} !important; }`);

  const stripH = n(layout.stripShiftHorizontal);
  if (stripH) rules.push(`${b} .strip-text { margin-left: ${stripH} !important; }`);

  const stripFs = n(layout.stripFontSize);
  if (stripFs) rules.push(`${b} .strip-text { font-size: ${stripFs} !important; }`);

  const stripStroke = n(layout.stripStrokeWidth);
  if (stripStroke) {
    rules.push(
      `${b} .strip-text { -webkit-text-stroke: ${stripStroke} var(--navy) !important; }`,
    );
  }

  const stripFf = safeFontFamily(layout.stripFontFamily);
  if (stripFf) {
    rules.push(`${b} .strip-text { font-family: "${stripFf}", sans-serif !important; }`);
  }

  // --- Validity date inside the yellow bar ---
  const valDown = n(layout.validityShiftDown);
  if (valDown) rules.push(`${b} .validity { margin-top: ${valDown} !important; }`);

  const valH = n(layout.validityShiftHorizontal);
  if (valH) rules.push(`${b} .validity { margin-left: ${valH} !important; }`);

  const valFs = n(layout.validityFontSize);
  if (valFs) rules.push(`${b} .validity { font-size: ${valFs} !important; }`);

  const valFf = safeFontFamily(layout.validityFontFamily);
  if (valFf) {
    rules.push(`${b} .validity { font-family: "${valFf}", sans-serif !important; }`);
  }

  // --- Barcode block ---
  const barDown = n(layout.barcodeShiftDown);
  if (barDown) rules.push(`${b} .barcode-block { margin-top: ${barDown} !important; }`);

  const barH = n(layout.barcodeShiftHorizontal);
  if (barH) rules.push(`${b} .barcode-block { margin-left: ${barH} !important; }`);

  const barW = n(layout.barcodeWidth);
  if (barW) rules.push(`${b} .barcode-block { width: ${barW} !important; }`);

  // Fixing the bar height means opting out of the block's flex stretch.
  const barHeight = n(layout.barcodeHeight);
  if (barHeight) {
    rules.push(`${b} .barcode { flex: none !important; height: ${barHeight} !important; }`);
  }

  const codeFs = n(layout.codeFontSize);
  if (codeFs) rules.push(`${b} .code { font-size: ${codeFs} !important; }`);

  const codeFf = safeFontFamily(layout.codeFontFamily);
  if (codeFf) {
    rules.push(`${b} .code { font-family: "${codeFf}", sans-serif !important; }`);
  }

  if (rules.length === 0) return "";
  return `\n/* Layout tweaks */\n${rules.join("\n")}\n`;
}

/**
 * Both sizes keep the artwork's 2.2217 aspect ratio, so nothing distorts.
 * A4 printable area is 200mm x 287mm at a 5mm margin.
 */
const SIZES = {
  small: {
    width: "100mm", // 2 columns across 200mm
    height: "45.02mm", // 100 / 2.2217
    perPage: 12, // 2 cols x 6 rows (6 x 45.02 = 270.1mm, fits 287mm)
    cols: 2,
  },
  large: {
    width: "197.23mm", // native artwork size
    height: "88.77mm",
    perPage: 3, // 3 x 88.77 = 266.3mm, fits 287mm
    cols: 1,
  },
};

/**
 * Runs in the browser before printing. Shrinks any text that would spill out
 * of its box, so an unusually long gift value, date or code degrades
 * gracefully instead of overlapping the artwork.
 *
 * Only ever scales DOWN, and never below 55% of the designed size — if it hits
 * that floor the value is genuinely too long and should be shortened by hand.
 */
function autoFitText() {
  const MIN_SCALE = 0.55;
  const STEP = 0.97;

  const shrinkToWidth = (el, available) => {
    if (!el || !available) return;
    const start = parseFloat(getComputedStyle(el).fontSize);
    let size = start;
    while (el.scrollWidth > available && size > start * MIN_SCALE) {
      size *= STEP;
      el.style.fontSize = `${size}px`;
    }
  };

  document.querySelectorAll(".coupon").forEach((coupon) => {
    // Validity must fit inside the yellow bar.
    const validity = coupon.querySelector(".validity");
    if (validity) {
      const cs = getComputedStyle(validity);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      shrinkToWidth(validity, validity.clientWidth - pad);
    }

    // The strip text is rotated, so its layout width runs along the coupon's
    // height and must fit within the strip's length.
    const strip = coupon.querySelector(".strip-text");
    if (strip) shrinkToWidth(strip, coupon.clientHeight * 0.92);

    // The code sits under the barcode.
    const code = coupon.querySelector(".code");
    if (code) shrinkToWidth(code, code.parentElement.clientWidth);
  });
}

async function generateCouponsHtml({
  coupons,
  size = "small",
  layout = null,
  templatePath = path.join(__dirname, "template.html"),
  bgPath = path.join(__dirname, "assets", "bg.png"),
}) {
  if (!Array.isArray(coupons) || coupons.length === 0) {
    throw new Error("No coupons provided");
  }

  const config = SIZES[size] || SIZES.small;
  const bgDataUri = toDataUri(bgPath);
  const fontCss = buildFontCss(path.join(__dirname, "assets"));

  let html = fs.readFileSync(templatePath, "utf8");
  html = html.replace("{{BG_DATA_URI}}", bgDataUri);
  html = html.replace("{{FONT_FACE_CSS}}", fontCss);

  const sizeCss = `
    .page {
      --page-cols: ${config.cols};
    }
    .coupon {
      --coupon-width: ${config.width};
      --coupon-height: ${config.height};
    }
  `;
  const layoutCss = buildLayoutCss(layout, size);
  html = html.replace("{{CSS_VARIABLES}}", sizeCss + layoutCss);
  html = html.replace("{{PAGES_HTML}}", buildPagesHtml(coupons, config.perPage));

  // Inlined so the HTML preview and the printed PDF fit text identically.
  // Waits for the embedded fonts, otherwise it would measure fallback metrics.
  const autoFitScript = `<script>
(function () {
  var fit = ${autoFitText.toString()};
  window.__autoFit = fit;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fit);
  } else {
    window.addEventListener("load", fit);
  }
})();
<\/script>`;
  html = html.replace("{{AUTOFIT_SCRIPT}}", autoFitScript);
  html = html.replace("<body>", `<body class="size-${size}">`);

  return html;
}

async function generateCouponsPdf({
  coupons,
  size = "small",
  layout = null,
  outputPdf,
  templatePath = path.join(__dirname, "template.html"),
  bgPath = path.join(__dirname, "assets", "bg.png"),
}) {
  const html = await generateCouponsHtml({
    coupons,
    size,
    layout,
    templatePath,
    bgPath,
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    // Idempotent — the inline script has usually already run by now, but this
    // guarantees the fit pass completed before we print.
    await page.evaluate(() => window.__autoFit && window.__autoFit());

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });

    if (outputPdf) {
      fs.writeFileSync(outputPdf, pdfBuffer);
    }

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

async function main() {
  const inputJson = process.argv[2] || "coupons.json";
  const outputPdf = process.argv[3] || "coupons.pdf";

  const data = JSON.parse(fs.readFileSync(inputJson, "utf8"));
  const size = data.size || "small";
  const layout = data.layout || null;
  const coupons = data.coupons || [];

  await generateCouponsPdf({ coupons, size, layout, outputPdf });
  console.log(`Saved: ${outputPdf}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  generateCouponsPdf,
  generateCouponsHtml,
  buildLayoutCss,
  LAYOUT_KEYS,
  RAW_LAYOUT_KEYS,
  FONT_FAMILIES,
  SIZES,
  ARTWORK_ASPECT,
};
