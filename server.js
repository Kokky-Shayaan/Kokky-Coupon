const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const {
  generateCouponsPdf,
  generateCouponsHtml,
  buildLayoutCss,
  LAYOUT_KEYS,
  RAW_LAYOUT_KEYS,
} = require("./render_pdf");

const app = express();
// 3001 by default so the v1 generator can keep running on 3000 alongside this.
const port = process.env.PORT || 3001;
const downloadsDir = path.join(__dirname, "downloads");

fs.mkdirSync(downloadsDir, { recursive: true });

/**
 * Generated files are kept so you can regenerate after tweaking the layout
 * without re-uploading. Nothing is deleted on use; instead anything older
 * than MAX_AGE_HOURS is swept away on boot and hourly after that.
 */
const MAX_AGE_HOURS = 24;
function sweepDownloads() {
  const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
  let removed = 0;
  try {
    for (const name of fs.readdirSync(downloadsDir)) {
      if (!/^(staging-.*\.upload|preview-.*\.html|coupons-.*\.pdf)$/.test(name)) continue;
      const full = path.join(downloadsDir, name);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) {
          fs.unlinkSync(full);
          removed++;
        }
      } catch (_) {}
    }
  } catch (_) {}
  if (removed) console.log(`Cleaned up ${removed} file(s) older than ${MAX_AGE_HOURS}h.`);
}
sweepDownloads();
setInterval(sweepDownloads, 60 * 60 * 1000).unref();

app.use(express.json({ limit: "40kb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function parseCouponCodes(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
  if (rows.length === 0) {
    return [];
  }

  // Prefer explicit "Code" column from the header row.
  const headerMap = Object.keys(rows[0]).reduce((acc, key) => {
    acc[key.toLowerCase().trim()] = key;
    return acc;
  }, {});

  const codeHeader = headerMap.code;
  if (codeHeader) {
    const codes = rows
      .map((row) => String(row[codeHeader] || "").trim())
      .filter(Boolean);
    return [...new Set(codes)];
  }

  // Fallback for files without headers: use first non-empty cell per row.
  const matrix = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  const fallbackCodes = matrix
    .map((row) => {
      if (!Array.isArray(row)) {
        return "";
      }
      const firstNonEmpty = row.find(
        (cell) => String(cell || "").trim().length > 0,
      );
      return String(firstNonEmpty || "").trim();
    })
    .filter(Boolean);

  return [...new Set(fallbackCodes)];
}

/**
 * Collect layout_* form fields into a layout object.
 * Plain numbers get "mm" appended, except for RAW_LAYOUT_KEYS (the font
 * pickers), which are passed through untouched.
 */
function parseLayoutFromBody(body) {
  const layout = {};
  for (const key of LAYOUT_KEYS) {
    const v = body[`layout_${key}`];
    if (v == null || String(v).trim() === "") continue;
    let s = String(v).trim();
    if (/^-?\d+(\.\d+)?$/.test(s) && !RAW_LAYOUT_KEYS.has(key)) {
      s = `${s}mm`;
    }
    layout[key] = s;
  }
  return Object.keys(layout).length ? layout : null;
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/preview", async (req, res) => {
  try {
    const size = req.query.size || "small";
    // Terms are part of the artwork, so sample data only needs the three
    // fields the generator actually draws.
    const dummyCoupons = [
      {
        code: "044F-BFB9-4B64",
        voucherType: "gift",
        giftValue: "MVR 350",
        validUntil: "2026-02-22",
      },
      {
        code: "TEST12345",
        voucherType: "discount",
        discountText: "15% OFF",
        validUntil: "2026-12-31",
      },
      {
        code: "SAMPLE999",
        voucherType: "gift",
        giftValue: "MVR 1000",
        validUntil: "2026-09-30",
      },
      // Filler so the small grid can be checked at a full 12 per page
      ...["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((code) => ({
        code: `SAMPLE-${code}`,
        voucherType: "discount",
        discountText: "5% OFF",
        validUntil: "2026-06-30",
      })),
    ];

    const html = await generateCouponsHtml({
      coupons: dummyCoupons,
      size,
    });

    res.send(html);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generating preview");
  }
});

app.use("/downloads", express.static(downloadsDir));

/** POST { layout, size } → CSS text (same rules as PDF) */
app.post("/api/layout-css", (req, res) => {
  try {
    const layout = req.body.layout || null;
    const size = req.body.size || "small";
    const css = buildLayoutCss(layout, size);
    res.type("text/css").send(css || "/* no layout overrides */");
  } catch (e) {
    res.status(500).send("Error building layout CSS");
  }
});

/**
 * Build preview HTML only + stash file buffer on disk for later PDF without re-upload.
 * POST multipart same as /api/generate but no PDF; returns preview URL + stagingId.
 */
app.post("/api/preview-only", upload.single("couponFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload an .xlsx or .csv file." });
    }
    let coupons;
    let size;
    try {
      const built = buildCouponsFromUploadBuffer(req.file.buffer, req.body);
      coupons = built.coupons;
      size = built.size;
    } catch (e) {
      return res.status(400).json({ error: e.message || "Invalid input." });
    }

    const stamp = Date.now();
    const stagingId = crypto.randomBytes(12).toString("hex");
    const stagingPath = path.join(downloadsDir, `staging-${stagingId}.upload`);
    fs.writeFileSync(stagingPath, req.file.buffer);

    const previewFilename = `preview-${stamp}.html`;
    const previewPath = path.join(downloadsDir, previewFilename);
    // No layout baked in — review page applies CSS live, then generate uses layout from form
    const previewHtml = await generateCouponsHtml({ coupons, size, layout: null });
    fs.writeFileSync(previewPath, previewHtml, "utf8");

    return res.json({
      preview: `/downloads/${previewFilename}`,
      stagingId,
      count: coupons.length,
      size,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to build preview." });
  }
});

/**
 * Terms are printed as part of the artwork, so a coupon only carries the
 * three values the generator draws: the strip text, the date and the code.
 */
function buildCouponsFromUploadBuffer(buffer, body) {
  const size = body.size || "small";
  let voucherType = (body.voucherType || "discount").toString().toLowerCase();
  const discountText = (body.discountText || "").trim();
  const giftValue = (body.giftValue || "").trim();
  if (giftValue) voucherType = "gift";
  const validUntil = (body.validUntil || "").trim();

  if (voucherType === "gift" && !giftValue) {
    throw new Error("Gift voucher requires a value (e.g. MVR 350) for the side strip.");
  }
  if (voucherType === "discount" && !discountText) {
    throw new Error("Discount voucher requires discount text (e.g. 20% OFF).");
  }

  const codes = parseCouponCodes(buffer);
  if (codes.length === 0) {
    throw new Error("No coupon codes found in the uploaded file.");
  }

  const coupons = codes.map((code) => {
    if (voucherType === "gift") {
      return { code, voucherType: "gift", giftValue, validUntil };
    }
    return { code, voucherType: "discount", discountText, validUntil };
  });
  return { coupons, size };
}

// Allow generate without file when stagingId is present (after preview-only)
app.post("/api/generate", (req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (!ct.includes("multipart/form-data")) {
    return res.status(400).json({ error: "Multipart form required." });
  }
  upload.any()(req, res, next);
}, async (req, res) => {
  try {
    let fileBuffer = null;
    const stagingId = (req.body.stagingId || "").trim();
    if (stagingId) {
      const stagingPath = path.join(downloadsDir, `staging-${stagingId}.upload`);
      if (!fs.existsSync(stagingPath)) {
        return res.status(400).json({
          error: "Session expired — please upload the file again or run Preview review again.",
        });
      }
      fileBuffer = fs.readFileSync(stagingPath);
    } else {
      const uploaded = Array.isArray(req.files)
        ? req.files.find((f) => f.fieldname === "couponFile")
        : null;
      if (uploaded) {
        fileBuffer = uploaded.buffer;
      }
    }
    if (!fileBuffer) {
      return res.status(400).json({
        error: "Please upload an .xlsx or .csv file, or open from Preview review with staging.",
      });
    }

    let coupons;
    let size;
    try {
      const built = buildCouponsFromUploadBuffer(fileBuffer, req.body);
      coupons = built.coupons;
      size = built.size;
    } catch (e) {
      return res.status(400).json({ error: e.message || "Invalid input." });
    }

    const stamp = Date.now();
    const filename = `coupons-${stamp}.pdf`;
    const outputPath = path.join(downloadsDir, filename);
    const previewFilename = `preview-${stamp}.html`;
    const previewPath = path.join(downloadsDir, previewFilename);

    const layout = parseLayoutFromBody(req.body);

    await generateCouponsPdf({
      coupons,
      size,
      layout,
      outputPdf: outputPath,
    });

    // Same HTML as PDF input — lets user review layout before downloading
    const previewHtml = await generateCouponsHtml({ coupons, size, layout });
    fs.writeFileSync(previewPath, previewHtml, "utf8");

    // The staging upload is deliberately KEPT so you can keep nudging the
    // layout and hit Generate again without re-uploading. It is cleared by
    // age instead — see sweepDownloads().

    return res.json({
      file: `/downloads/${filename}`,
      preview: `/downloads/${previewFilename}`,
      count: coupons.length,
    });
  } catch (error) {
    console.error(error);
    // Surface the real reason — "Failed to generate PDF" alone is untraceable.
    const detail = error && error.message ? String(error.message).split("\n")[0] : "";
    const missingBrowser = /Executable doesn't exist|playwright install/i.test(detail);
    return res.status(500).json({
      error: missingBrowser
        ? "Chromium is not installed for Playwright. Run: npx playwright install chromium"
        : `Failed to generate PDF${detail ? ": " + detail : "."}`,
    });
  }
});

app.listen(port, () => {
  console.log(`Kokky voucher generator (candy design) running at http://localhost:${port}`);
});
