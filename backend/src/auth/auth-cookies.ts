import type { Response } from 'express';

// Everything about the login cookie, in one place
export const AUTH_COOKIE = 'taskToken';

// Shared by setting and clearing the cookie: browsers only clear a cookie if the options match
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};

const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 1 day, the same as the JWT's expiresIn

// Login and change-password both hand out a token the same way
export function setLoginCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: COOKIE_MAX_AGE });
}

// Logout and delete-account: tells the browser to remove it (JavaScript can't, the cookie is httpOnly)
export function clearLoginCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, COOKIE_OPTIONS);
}
