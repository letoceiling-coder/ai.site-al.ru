import { cookies } from "next/headers";
import { prisma } from "@ai/db";
import { signAccessToken } from "@ai/auth";
import { sha256 } from "@/lib/crypto";
import { fail, ok } from "@/lib/http";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refresh_token")?.value;
  if (!refreshToken) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const session: any = await prisma.session.findFirst({
    where: {
      refreshTokenHash: sha256(refreshToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: {
          id: true,
          tenantId: true,
          email: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!session?.user || session.user.deletedAt) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const accessToken = await signAccessToken({
    sub: session.user.id,
    email: session.user.email,
    tenantId: session.user.tenantId,
  });

  const response = ok({ refreshed: true });
  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 15,
  });
  return response;
}
