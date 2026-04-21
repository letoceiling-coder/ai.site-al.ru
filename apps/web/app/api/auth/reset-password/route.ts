import { prisma } from "@ai/db";
import { hashPassword } from "@ai/auth";
import { sha256 } from "@/lib/crypto";
import { fail, ok } from "@/lib/http";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (token.length < 16 || password.length < 8) {
    return fail("Некорректный payload");
  }

  const tokenHash = sha256(token);
  const resetToken: any = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!resetToken || resetToken.consumedAt || resetToken.expiresAt < new Date()) {
    return fail("Токен недействителен", "TOKEN_INVALID", 400);
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: resetToken.userId },
    data: { passwordHash },
  });
  await prisma.passwordResetToken.update({
    where: { id: resetToken.id },
    data: { consumedAt: new Date() },
  });

  return ok({ reset: true });
}
