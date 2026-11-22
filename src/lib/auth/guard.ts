import { NextResponse } from "next/server";
import { getCurrentSession, type SessionPayload } from "./session";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/** Throws AuthError (catch in the route and map to a JSON response) if not authenticated / not authorized. */
export async function requireSession(allowedRoles?: SessionPayload["role"][]): Promise<SessionPayload> {
  const session = await getCurrentSession();
  if (!session) throw new AuthError("Authentication required.", 401);
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    throw new AuthError("You do not have permission to perform this action.", 403);
  }
  return session;
}

export function authErrorResponse(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return null;
}
