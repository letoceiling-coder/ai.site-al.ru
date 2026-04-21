import { cookies } from "next/headers";
import { prisma } from "@ai/db";
import { sha256 } from "@/lib/crypto";
import { ok } from "@/lib/http";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refresh_token")?.value;

  if (refreshToken) {
    await prisma.session.updateMany({
      where: { refreshTokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  const response = ok({ loggedOut: true });
  response.cookies.delete("access_token");
  response.cookies.delete("refresh_token");
  response.cookies.delete("tenant_slug");
  return response;
}
