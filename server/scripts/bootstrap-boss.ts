import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/password";
import { encryptManagementSecret } from "../src/utils/managementCrypto";
import { normalizeTotpSecret } from "../src/utils/totp";

const prisma = new PrismaClient();

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const username = required("BOSS_USERNAME");
  const password = required("BOSS_PASSWORD");
  const displayName = String(process.env.BOSS_DISPLAY_NAME || "BOSS").trim() || "BOSS";
  const totpSecret = normalizeTotpSecret(required("BOSS_TOTP_SECRET"));
  if (!/^[A-Za-z0-9_]{3,64}$/.test(username)) throw new Error("BOSS_USERNAME must contain 3-64 letters, numbers, or underscores");
  if (password.length < 12) throw new Error("BOSS_PASSWORD must be at least 12 characters");

  const existing = await prisma.adminAccount.findFirst({ where: { accountType: "boss" }, select: { id: true, username: true } });
  if (existing) throw new Error(`A BOSS account already exists: ${existing.username}`);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8172634519921)`;
    const raceCheck = await tx.adminAccount.findFirst({ where: { accountType: "boss" }, select: { username: true } });
    if (raceCheck) throw new Error(`A BOSS account already exists: ${raceCheck.username}`);
    await tx.adminAccount.create({
      data: {
        username,
        passwordHash: await hashPassword(password),
        displayName,
        accountType: "boss",
        status: "active",
        mfaEnabled: true,
        mfaSecretCiphertext: encryptManagementSecret(totpSecret),
      },
    });
  });
  console.log(`BOSS account created: ${username}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
