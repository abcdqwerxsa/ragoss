/** Extension-based mime inference (no dependency). Unknown -> application/octet-stream. */
const MIME: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
  json: "application/json",
  csv: "text/csv",
  html: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  heic: "image/heic",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  epub: "application/epub+zip",
};

export function mimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export function kindFromMime(mime: string): "text" | "image" | "audio" | "video" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "text";
}
