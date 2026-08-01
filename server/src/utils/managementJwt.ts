import jwt from "jsonwebtoken";
import { config } from "../config";

const MANAGEMENT_JWT_ISSUER = "xjtlu-management";
const MANAGEMENT_JWT_AUDIENCE = "xjtlu-management";

export interface ManagementJwtPayload {
  adminAccountId: number;
  sessionId: string;
  accountType: "boss" | "admin";
}

export function signManagementToken(payload: ManagementJwtPayload) {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.managementJwtExpiresIn,
    issuer: MANAGEMENT_JWT_ISSUER,
    audience: MANAGEMENT_JWT_AUDIENCE,
  } as jwt.SignOptions);
}

export function verifyManagementToken(token: string): ManagementJwtPayload {
  return jwt.verify(token, config.jwtSecret, {
    issuer: MANAGEMENT_JWT_ISSUER,
    audience: MANAGEMENT_JWT_AUDIENCE,
  }) as ManagementJwtPayload;
}
