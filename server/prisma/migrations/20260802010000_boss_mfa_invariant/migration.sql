-- A BOSS account is never allowed to exist without an encrypted MFA secret.
ALTER TABLE "AdminAccount"
  ADD CONSTRAINT "AdminAccount_boss_requires_mfa_check"
  CHECK (
    "accountType" <> 'boss'
    OR ("mfaEnabled" = TRUE AND "mfaSecretCiphertext" IS NOT NULL)
  );
