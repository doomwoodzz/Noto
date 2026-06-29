/** Augment Express' Request with the cookies map our middleware populates. */
import "express";

declare global {
  namespace Express {
    interface Request {
      cookies: Record<string, string>;
      apiUser?: { userId: string; scopes: string[]; tokenId: string };
    }
  }
}
