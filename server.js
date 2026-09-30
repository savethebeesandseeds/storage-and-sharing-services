const express = require("express");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { pipeline } = require("stream/promises");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8084);
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(__dirname, "shared", "received");
const DOWNLOAD_DIR =
  process.env.DOWNLOAD_DIR || path.join(__dirname, "shared", "available");
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 1024);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
  ["image/avif", ".avif"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"],
  ["video/x-m4v", ".m4v"],
  ["video/mpeg", ".mpeg"],
  ["video/ogg", ".ogv"],
  ["video/x-msvideo", ".avi"],
  ["video/x-matroska", ".mkv"],
  ["video/3gpp", ".3gp"],
  ["video/3gpp2", ".3g2"],
]);

const DOWNLOAD_MIME_TYPES = new Map([
  ...Array.from(MIME_EXTENSIONS, ([mimeType, extension]) => [extension, mimeType]),
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".csv", "text/csv"],
  [".json", "application/json"],
  [".pdf", "application/pdf"],
  [".zip", "application/zip"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
]);

const downloadHashCache = new Map();

function safeUploadName(originalName) {
  // The receiving folder is on Windows, even though Node runs in Linux.
  let name = path.win32.basename(path.posix.basename(originalName || ""))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "");
  if (!name) name = "file";
  if (/^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(name)) {
    name = `_${name}`;
  }
  return name;
}

async function saveUpload(file) {
  const originalName = safeUploadName(file.originalname);
  const extension = path.extname(originalName);
  const stem = originalName.slice(0, originalName.length - extension.length);
  let filename;
  let filePath;
  let handle;

  for (let suffix = 0; ; suffix++) {
    filename = suffix === 0 ? originalName : `${stem} (${suffix})${extension}`;
    filePath = path.join(UPLOAD_DIR, filename);
    try {
      // Exclusive creation also protects files during concurrent uploads.
      handle = await fs.promises.open(filePath, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }

  file.path = filePath;
  try {
    const output = handle.createWriteStream();
    await pipeline(file.stream, output);
    return { destination: UPLOAD_DIR, filename, path: filePath, size: output.bytesWritten };
  } catch (error) {
    await handle.close();
    await fs.promises.unlink(filePath).catch((cleanupError) => {
      if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError;
    });
    throw error;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const escapes = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escapes[char];
  });
}

function wantsJson(req) {
  return (
    req.get("X-Requested-With") === "XMLHttpRequest" ||
    req.accepts(["json", "html"]) === "json"
  );
}

function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function cachedFileSha256(filePath, stat) {
  const cacheKey = `${stat.size}:${stat.mtimeMs}`;
  const cached = downloadHashCache.get(filePath);
  if (cached && cached.cacheKey === cacheKey) return cached.sha256;

  const sha256 = await fileSha256(filePath);
  downloadHashCache.set(filePath, { cacheKey, sha256 });
  return sha256;
}

async function listDownloadFiles() {
  const entries = await fs.promises.readdir(DOWNLOAD_DIR, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map(async (entry) => {
        const filePath = path.join(DOWNLOAD_DIR, entry.name);

        try {
          const stat = await fs.promises.stat(filePath);
          if (!stat.isFile()) return null;

          return {
            name: entry.name,
            extension: path.extname(entry.name).toLowerCase(),
            mimeType:
              DOWNLOAD_MIME_TYPES.get(path.extname(entry.name).toLowerCase()) ||
              "application/octet-stream",
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            modifiedMs: stat.mtimeMs,
            sha256: await cachedFileSha256(filePath, stat),
            url: `/download/${encodeURIComponent(entry.name)}`,
          };
        } catch (error) {
          if (error.code === "ENOENT") return null;
          throw error;
        }
      })
  );

  return files
    .filter(Boolean)
    .sort((left, right) => right.modifiedMs - left.modifiedMs || left.name.localeCompare(right.name));
}

const storage = {
  _handleFile(req, file, cb) {
    saveUpload(file).then((info) => cb(null, info), cb);
  },
  _removeFile(req, file, cb) {
    const filePath = file.path;
    delete file.destination;
    delete file.filename;
    delete file.path;
    fs.unlink(filePath, (error) => cb(error && error.code !== "ENOENT" ? error : null));
  },
};

const upload = multer({
  storage,
  defParamCharset: "utf8",
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 50 },
});

const app = express();

app.disable("x-powered-by");

app.get("/healthz", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    checkedAt: new Date().toISOString(),
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.use("/uploads", express.static(UPLOAD_DIR, {
  index: false,
  dotfiles: "allow",
  setHeaders: (res, filePath) => {
    // Arbitrary uploaded files must download instead of running on this origin.
    res.attachment(path.basename(filePath));
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
}));

app.get("/api/downloads", async (req, res, next) => {
  try {
    const files = await listDownloadFiles();
    res.set("Cache-Control", "no-store");
    res.status(200).json({
      count: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      files,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/download/:name", (req, res, next) => {
  const requestedName = req.params.name;
  const safeName = path.basename(requestedName);

  if (!safeName || safeName !== requestedName || safeName.startsWith(".")) {
    return res.status(400).send("Invalid download name.");
  }

  res.download(path.join(DOWNLOAD_DIR, safeName), safeName, (error) => {
    if (error && !res.headersSent) next(error);
  });
});

// Retain the existing multipart field name for clients using the upload API.
app.post("/upload", upload.array("images", 50), async (req, res, next) => {
  try {
    const clientHashes = Array.isArray(req.body.sha256)
      ? req.body.sha256
      : req.body.sha256
        ? [req.body.sha256]
        : [];

    const files = await Promise.all(
      (req.files || []).map(async (f, index) => {
        const sha256 = await fileSha256(f.path);
        const clientSha256 = clientHashes[index] || null;

        return {
          originalName: f.originalname,
          name: f.filename,
          mimeType: f.mimetype,
          size: f.size,
          sizeKB: Math.round(f.size / 1024),
          sha256,
          clientSha256,
          hashMatch: clientSha256 ? clientSha256.toLowerCase() === sha256 : null,
          url: `/uploads/${encodeURIComponent(f.filename)}`,
        };
      })
    );

    if (wantsJson(req)) {
      return res.status(200).json({
        count: files.length,
        files,
        uploadDir: UPLOAD_DIR,
        receivedAt: new Date().toISOString(),
      });
    }

    res.status(200).send(`
    <!doctype html>
    <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family: system-ui; padding: 16px;">
        <h2>Uploaded ${files.length} file(s)</h2>
        <p>Saved to: <code>${escapeHtml(UPLOAD_DIR)}</code></p>
        <ul>
          ${files
            .map((f) => {
              return `<li><a href="${f.url}">${escapeHtml(f.name)}</a> (${f.sizeKB} KB, SHA-256 ${escapeHtml(f.sha256)})</li>`;
            })
            .join("")}
        </ul>
        <p><a href="/">Upload more</a></p>
      </body>
    </html>
  `);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  if (wantsJson(req)) {
    return res.status(400).json({ error: err.message });
  }

  res.status(400).send(`
    <p style="font-family: system-ui; padding: 16px;">
      Upload failed: <b>${escapeHtml(err.message)}</b><br><br>
      <a href="/">Back</a>
    </p>
  `);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Storage and sharing service: http://${HOST}:${PORT}`);
  console.log(`Receiving files into: ${UPLOAD_DIR}`);
  console.log(`Serving files from: ${DOWNLOAD_DIR}`);
  console.log(`Maximum file size: ${MAX_FILE_SIZE_MB} MB`);
  if (HOST === "0.0.0.0") console.log("Listening on all interfaces (LAN accessible).");
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping.`);

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close((error) => {
    clearTimeout(forceExit);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
