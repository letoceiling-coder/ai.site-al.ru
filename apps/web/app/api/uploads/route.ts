import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["image/", "audio/", "text/"];
const ALLOWED_EXACT_MIMES = [
  "application/pdf",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];
const ALLOWED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".pdf",
  ".doc",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
]);

function sanitizeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

function canUploadMime(mimeType: string) {
  if (!mimeType) {
    return false;
  }
  if (ALLOWED_EXACT_MIMES.includes(mimeType)) {
    return true;
  }
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function inferMimeByExtension(extension: string) {
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
  };
  return map[extension] ?? null;
}

function canUploadFile(file: File, extension: string) {
  if (canUploadMime(file.type)) {
    return true;
  }
  if ((file.type === "application/octet-stream" || !file.type) && ALLOWED_EXTENSIONS.has(extension)) {
    return true;
  }
  return false;
}

export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return fail("Invalid multipart form", "BAD_REQUEST", 400);
  }

  const files = form
    .getAll("files")
    .filter((item): item is File => typeof File !== "undefined" && item instanceof File)
    .slice(0, 10);

  if (files.length === 0) {
    return fail("No files received", "BAD_REQUEST", 400);
  }

  const uploadRoot = join(process.cwd(), "public", "uploads", auth.tenantId);
  await mkdir(uploadRoot, { recursive: true });

  const uploaded: Array<{ name: string; url: string; mimeType: string; size: number }> = [];

  for (const file of files) {
    const extension = extname(file.name || "").toLowerCase().slice(0, 10);
    if (!canUploadFile(file, extension)) {
      return fail(`Unsupported mime type: ${file.type || "unknown"}`, "BAD_REQUEST", 400);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return fail(`File is too large: ${file.name}`, "BAD_REQUEST", 400);
    }
    const bytes = await file.arrayBuffer();
    const safeName = sanitizeFilename(file.name || "upload");
    const objectName = `${Date.now()}_${randomUUID()}${extension}`;
    const objectPath = join(uploadRoot, objectName);
    const normalizedMime =
      file.type && file.type !== "application/octet-stream"
        ? file.type
        : inferMimeByExtension(extension) ?? "application/octet-stream";
    await writeFile(objectPath, Buffer.from(bytes));
    uploaded.push({
      name: safeName,
      url: `/uploads/${auth.tenantId}/${objectName}`,
      mimeType: normalizedMime,
      size: file.size,
    });
  }

  return ok({
    files: uploaded,
  });
}
