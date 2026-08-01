import type { JwtPayload } from "../utils/jwt";
import type { BrowserSession } from "../services/browserSession";
import type { ManagementPrincipal } from "../services/managementAuthService";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      browserSessionId?: string;
      browserSession?: BrowserSession;
      management?: ManagementPrincipal;
    }
  }
}
export {};
