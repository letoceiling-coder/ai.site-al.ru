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
    if (!canUploadMime(file.type)) {
      return fail(`Unsupported mime type: ${file.type || "unknown"}`, "BAD_REQUEST", 400);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return fail(`File is too large: ${file.name}`, "BAD_REQUEST", 400);
    }
    const bytes = await file.arrayBuffer();
    const extension = extname(file.name || "").slice(0, 10);
    const safeName = sanitizeFilename(file.name || "upload");
    const objectName = `${Date.now()}_${randomUUID()}${extension}`;
    const objectPath = join(uploadRoot, objectName);
    await writeFile(objectPath, Buffer.from(bytes));
    uploaded.push({
      name: safeName,
      url: `/uploads/${auth.tenantId}/${objectName}`,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });
  }

  return ok({
    files: uploaded,
  });
}
