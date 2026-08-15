const fileInput = document.getElementById("fileInput");
const uploadButton = document.getElementById("uploadButton");
const clearButton = document.getElementById("clearButton");
const fileRows = document.getElementById("fileRows");
const fileCount = document.getElementById("fileCount");
const byteCount = document.getElementById("byteCount");
const completeCount = document.getElementById("completeCount");
const overallProgress = document.getElementById("overallProgress");
const overallPercent = document.getElementById("overallPercent");
const runtimeStatus = document.getElementById("runtimeStatus");
const originLabel = document.getElementById("originLabel");
const refreshDownloads = document.getElementById("refreshDownloads");
const downloadRows = document.getElementById("downloadRows");
const downloadCount = document.getElementById("downloadCount");
const downloadBytes = document.getElementById("downloadBytes");
const downloadChecked = document.getElementById("downloadChecked");
const CLIENT_HASH_LIMIT_BYTES = 256 * 1024 * 1024;

let records = [];
let nextId = 1;
let uploading = false;

originLabel.textContent = window.location.origin;

refreshDownloads.addEventListener("click", () => loadDownloads());
loadDownloads();

fileInput.addEventListener("change", () => {
  const selected = Array.from(fileInput.files || []);
  const newRecords = selected.map((file) => createRecord(file));

  records = records.concat(newRecords);
  fileInput.value = "";
  render();

  for (const record of newRecords) {
    loadMediaDetails(record);
    ensureClientHash(record);
  }
});

uploadButton.addEventListener("click", async () => {
  if (uploading) return;
  uploading = true;
  setRuntimeStatus("Uploading");
  renderControls();

  for (const record of records) {
    if (record.done || record.removed) continue;
    await uploadRecord(record);
  }

  uploading = false;
  setRuntimeStatus("Idle");
  renderControls();
  updateSummary();
});

clearButton.addEventListener("click", () => {
  if (uploading) return;
  records = [];
  render();
});

async function loadDownloads() {
  refreshDownloads.disabled = true;
  refreshDownloads.textContent = "Scanning...";

  try {
    const response = await fetch("/api/downloads", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `Download list failed (${response.status})`);
    }

    renderDownloadRows(result.files || []);
    downloadCount.textContent = `${result.count} file${result.count === 1 ? "" : "s"}`;
    downloadBytes.textContent = formatBytes(result.totalBytes || 0);
    downloadChecked.textContent = `checked ${formatDate(Date.parse(result.generatedAt))}`;
  } catch (error) {
    renderDownloadError(error.message);
    downloadChecked.textContent = "check failed";
  } finally {
    refreshDownloads.disabled = false;
    refreshDownloads.textContent = "Refresh files";
  }
}

function renderDownloadRows(files) {
  downloadRows.replaceChildren();

  if (files.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty";
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No files in shared/available.";
    row.append(cell);
    downloadRows.append(row);
    return;
  }

  for (const file of files) {
    const row = document.createElement("tr");
    row.append(
      downloadFileCell(file),
      textCell(formatBytes(file.size), "mono"),
      textCell(file.mimeType || "application/octet-stream", "mono"),
      textCell(formatDate(Date.parse(file.modifiedAt)), "mono"),
      hashCell(file.sha256, "server"),
      downloadActionCell(file)
    );
    downloadRows.append(row);
  }
}

function renderDownloadError(message) {
  downloadRows.replaceChildren();
  const row = document.createElement("tr");
  row.className = "empty error-row";
  const cell = document.createElement("td");
  cell.colSpan = 6;
  cell.textContent = `Unable to list shared/available: ${message}`;
  row.append(cell);
  downloadRows.append(row);
}

function downloadFileCell(file) {
  const cell = document.createElement("td");
  const name = document.createElement("div");
  const detail = document.createElement("div");
  name.className = "file-name";
  name.textContent = file.name;
  detail.className = "subtle mono";
  detail.textContent = file.extension || "no extension";
  cell.append(name, detail);
  return cell;
}

function downloadActionCell(file) {
  const cell = document.createElement("td");
  const link = document.createElement("a");
  link.className = "button download-link";
  link.href = file.url;
  link.download = file.name;
  link.textContent = "Download";
  cell.append(link);
  return cell;
}

function createRecord(file) {
  return {
    id: nextId++,
    file,
    dimensions: "reading",
    clientHash: "",
    clientHashStatus: "pending",
    serverHash: "",
    serverName: "",
    serverUrl: "",
    hashMatch: null,
    status: "queued",
    message: "",
    progress: 0,
    uploadedBytes: 0,
    done: false,
    error: "",
    hashPromise: null,
  };
}

function setRuntimeStatus(value) {
  runtimeStatus.textContent = value;
}

function render() {
  renderControls();
  renderRows();
  updateSummary();
}

function renderControls() {
  const hasFiles = records.length > 0;
  uploadButton.disabled = !hasFiles || uploading || records.every((record) => record.done);
  clearButton.disabled = !hasFiles || uploading;
}

function renderRows() {
  fileRows.replaceChildren();

  if (records.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty";
    const cell = document.createElement("td");
    cell.colSpan = 10;
    cell.textContent = "No files selected.";
    row.append(cell);
    fileRows.append(row);
    return;
  }

  for (const record of records) {
    fileRows.append(renderRow(record));
  }
}

function renderRow(record) {
  const row = document.createElement("tr");
  row.dataset.id = record.id;

  row.append(
    fileCell(record),
    textCell(formatBytes(record.file.size), "mono"),
    textCell(record.file.type || "unknown", "mono"),
    textCell(record.dimensions, "mono"),
    textCell(formatDate(record.file.lastModified), "mono"),
    hashCell(record.clientHash, record.clientHashStatus),
    statusCell(record),
    hashCell(record.serverHash, record.hashMatch === true ? "match" : record.serverHash ? "server" : "missing"),
    savedCell(record),
    actionCell(record)
  );

  return row;
}

function fileCell(record) {
  const cell = document.createElement("td");
  const name = document.createElement("div");
  const detail = document.createElement("div");

  name.className = "file-name";
  name.textContent = record.file.name;
  detail.className = "subtle mono";
  detail.textContent = `lastModified=${record.file.lastModified}`;

  cell.append(name, detail);
  return cell;
}

function textCell(text, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text || "";
  return cell;
}

function hashCell(hash, state) {
  const cell = document.createElement("td");
  cell.className = `hash ${state === "match" ? "match" : ""} ${state === "missing" ? "missing" : ""}`;

  if (!hash) {
    cell.textContent = state === "pending" ? "pending" : "not available";
    return cell;
  }

  cell.title = hash;
  cell.textContent = `${hash.slice(0, 16)}...${hash.slice(-16)}`;
  return cell;
}

function statusCell(record) {
  const cell = document.createElement("td");
  const label = document.createElement("strong");
  const progress = document.createElement("progress");
  const detail = document.createElement("div");

  cell.className = "status";
  label.className = statusClass(record);
  label.textContent = statusLabel(record);
  progress.className = "mini-progress";
  progress.max = 100;
  progress.value = record.progress;
  detail.className = "subtle";
  detail.textContent = statusDetail(record);

  cell.append(label, progress, detail);
  return cell;
}

function savedCell(record) {
  const cell = document.createElement("td");
  cell.className = "saved";

  if (!record.serverName) {
    cell.textContent = "-";
    return cell;
  }

  const link = document.createElement("a");
  link.href = record.serverUrl;
  link.textContent = record.serverName;
  link.target = "_blank";
  link.rel = "noreferrer";
  cell.append(link);
  return cell;
}

function actionCell(record) {
  const cell = document.createElement("td");
  const button = document.createElement("button");

  button.type = "button";
  button.className = "remove";
  button.textContent = "Remove";
  button.disabled = uploading;
  button.addEventListener("click", () => {
    records = records.filter((candidate) => candidate.id !== record.id);
    render();
  });

  cell.append(button);
  return cell;
}

function updateSummary() {
  const totalBytes = records.reduce((sum, record) => sum + record.file.size, 0);
  const uploadedBytes = records.reduce((sum, record) => sum + Math.min(record.uploadedBytes, record.file.size), 0);
  const complete = records.filter((record) => record.done).length;
  const percent = totalBytes === 0 ? 0 : Math.round((uploadedBytes / totalBytes) * 100);

  fileCount.textContent = `${records.length} file${records.length === 1 ? "" : "s"}`;
  byteCount.textContent = formatBytes(totalBytes);
  completeCount.textContent = `${complete} complete`;
  overallProgress.value = percent;
  overallPercent.textContent = `${percent}%`;
}

async function loadMediaDetails(record) {
  try {
    record.dimensions = await mediaDimensions(record.file);
  } catch (error) {
    record.dimensions = "unavailable";
  }
  renderRows();
}

function mediaDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);

    if (file.type.startsWith("image/")) {
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(`${image.naturalWidth}x${image.naturalHeight}`);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve("unavailable");
      };
      image.src = url;
      return;
    }

    if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(`${video.videoWidth}x${video.videoHeight}`);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve("unavailable");
      };
      video.src = url;
      return;
    }

    URL.revokeObjectURL(url);
    resolve("unavailable");
  });
}

function ensureClientHash(record) {
  if (record.hashPromise) return record.hashPromise;

  if (record.file.size > CLIENT_HASH_LIMIT_BYTES) {
    record.clientHashStatus = "missing";
    record.message = "client hash skipped for files over 256 MB";
    record.hashPromise = Promise.resolve("");
    renderRows();
    return record.hashPromise;
  }

  record.hashPromise = (async () => {
    record.clientHashStatus = "hashing";
    renderRows();

    try {
      record.clientHash = await sha256Hex(record.file);
      record.clientHashStatus = "ready";
    } catch (error) {
      record.clientHash = "";
      record.clientHashStatus = "missing";
      record.message = error.message;
    }

    renderRows();
    return record.clientHash;
  })();

  return record.hashPromise;
}

async function sha256Hex(file) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error("crypto.subtle unavailable");
  }

  const buffer = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function uploadRecord(record) {
  record.status = "hashing";
  record.error = "";
  render();

  const clientHash = await ensureClientHash(record);
  record.status = "uploading";
  record.progress = 0;
  record.uploadedBytes = 0;
  render();

  try {
    const response = await postFile(record.file, clientHash, (event) => {
      if (event.lengthComputable) {
        record.progress = Math.round((event.loaded / event.total) * 100);
        record.uploadedBytes = Math.min(event.loaded, record.file.size);
      } else {
        record.progress = 0;
        record.uploadedBytes = 0;
      }
      render();
    });

    const saved = response.files && response.files[0];
    if (!saved) throw new Error("Server did not return file metadata.");

    record.serverHash = saved.sha256 || "";
    record.serverName = saved.name || "";
    record.serverUrl = saved.url || "";
    record.hashMatch = saved.hashMatch;
    record.status = "done";
    record.done = true;
    record.progress = 100;
    record.uploadedBytes = record.file.size;
  } catch (error) {
    record.status = "error";
    record.error = error.message;
  }

  render();
}

function postFile(file, clientHash, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("images", file, file.name);
    if (clientHash) formData.append("sha256", clientHash);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    xhr.upload.onprogress = onProgress;

    xhr.onload = () => {
      let parsed;

      try {
        parsed = JSON.parse(xhr.responseText);
      } catch (error) {
        reject(new Error(`Invalid JSON response (${xhr.status})`));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed);
      } else {
        reject(new Error(parsed.error || `Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.send(formData);
  });
}

function statusLabel(record) {
  if (record.status === "done") return "saved";
  if (record.status === "error") return "failed";
  if (record.status === "uploading") return "uploading";
  if (record.status === "hashing" || record.clientHashStatus === "hashing") return "hashing";
  return "queued";
}

function statusClass(record) {
  if (record.status === "done") return "ok";
  if (record.status === "error") return "error";
  if (record.status === "uploading" || record.status === "hashing") return "busy";
  if (record.clientHashStatus === "missing") return "warn";
  return "";
}

function statusDetail(record) {
  if (record.error) return record.error;
  if (record.status === "uploading") return `${formatBytes(record.uploadedBytes)} sent`;
  if (record.status === "done") return record.hashMatch === false ? "hash mismatch" : "hash verified";
  if (record.clientHashStatus === "missing") return record.message || "client hash unavailable";
  return `${record.progress}%`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return "unknown";
  return new Date(value).toLocaleString();
}
