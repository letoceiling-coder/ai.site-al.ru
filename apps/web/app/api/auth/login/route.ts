import { prisma } from "@ai/db";
import { verifyPassword, signAccessToken } from "@ai/auth";
import { randomToken, sha256 } from "@/lib/crypto";
import { fail, ok } from "@/lib/http";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email.includes("@") || password.length < 8) {
    return fail("Некорректный payload");
  }

  const users: any[] = await prisma.user.findMany({
    where: { email: email.toLowerCase(), deletedAt: null },
    include: { tenant: true },
    take: 2,
  });

  if (users.length === 0) {
    return fail("Неверные учетные данные", "INVALID_CREDENTIALS", 401);
  }
  if (users.length > 1) {
    return fail("Найдено несколько аккаунтов с этим email", "MULTIPLE_ACCOUNTS", 409);
  }
  const user: any = users[0];
  const tenant: any = user.tenant;

  if (!tenant) {
    return fail("Неверные учетные данные", "INVALID_CREDENTIALS", 401);
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return fail("Неверные учетные данные", "INVALID_CREDENTIALS", 401);
  }

  const accessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    tenantId: tenant.id,
  });

  const refreshToken = randomToken(48);
  await prisma.session.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      refreshTokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const response = ok({ tenantId: tenant.id, userId: user.id });
  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 15,
  });
  response.cookies.set("refresh_token", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  response.cookies.set("tenant_slug", tenant.slug, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
