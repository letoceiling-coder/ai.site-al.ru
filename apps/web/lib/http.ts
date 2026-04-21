import { NextResponse } from "next/server";
import type { ApiResponse } from "@ai/shared";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiResponse<T>>({ ok: true, data }, { status });
}

export function fail(message: string, code = "BAD_REQUEST", status = 400) {
  return NextResponse.json<ApiResponse<never>>(
    {
      ok: false,
      error: { code, message },
    },
    { status },
  );
}
