import jwt from "jsonwebtoken";
import { config } from "../config";

const JWT_ISSUER = "xjtlu-web";
const JWT_AUDIENCE = "xjtlu-web";

export interface JwtPayload {
  userId: number;
  studentId: string;
  role: string;
  campus: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as JwtPayload;
}

/** 仅供已通过随机 HttpOnly 服务端会话定位到的 JWT 续签使用。 */
export function verifySessionTokenSignature(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    ignoreExpiration: true,
  }) as JwtPayload;
}
