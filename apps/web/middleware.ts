import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];

function isAccessTokenFresh(token: string | undefined) {
  if (!token) {
    return false;
  }
  try {
    const encoded = token.split(".")[0];
    if (!encoded) {
      return false;
    }
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    if (typeof payload.exp !== "number") {
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    return payload.exp > now + 30;
  } catch {
    return false;
  }
}

async function refreshAccessToken(request: NextRequest) {
  const response = await fetch(new URL("/api/auth/refresh", request.url), {
    method: "POST",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    return null;
  }
  const match = setCookie.match(/access_token=([^;]+)/);
  return match?.[1] ?? null;
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  const refreshToken = request.cookies.get("refresh_token")?.value;
  const isPublicRoute = publicRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route),
  );

  if (!isPublicRoute && !token && !refreshToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if ((token || refreshToken) && isPublicRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!isPublicRoute && refreshToken && !isAccessTokenFresh(token)) {
    return refreshAccessToken(request).then((nextToken) => {
      if (!nextToken) {
        if (!token) {
          const loginUrl = new URL("/login", request.url);
          loginUrl.searchParams.set("next", request.nextUrl.pathname);
          return NextResponse.redirect(loginUrl);
        }
        return NextResponse.next();
      }
      const response = NextResponse.next();
      response.cookies.set("access_token", nextToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 15,
      });
      return response;
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
