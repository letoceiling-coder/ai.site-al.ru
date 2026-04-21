// @ts-nocheck
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const prismaClientModule = require("@prisma/client");
const PrismaClientCtor = prismaClientModule.PrismaClient;
const Prisma = prismaClientModule.Prisma;

const globalForPrisma = globalThis as unknown as { prisma?: InstanceType<typeof PrismaClientCtor> };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClientCtor({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export const PrismaClient = PrismaClientCtor;
export { Prisma };
