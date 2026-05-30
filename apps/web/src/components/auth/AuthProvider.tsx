"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./AuthContext";

const TOKEN_STORAGE_KEY = "clicked_token";

function decodeUserId(token: string): string | null {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) {
      return null;
    }

    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(window.atob(padded)) as { userId?: unknown };

    return typeof parsed.userId === "string" ? parsed.userId : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedToken) {
      setTokenState(storedToken);
      setUserId(decodeUserId(storedToken));
    }

    setLoading(false);
  }, []);

  const setToken = useCallback((nextToken: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
    }

    setTokenState(nextToken);
    setUserId(decodeUserId(nextToken));
  }, []);

  const clearToken = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }

    setTokenState(null);
    setUserId(null);
  }, []);

  const value = useMemo(
    () => ({
      token,
      userId,
      loading,
      setToken,
      clearToken,
    }),
    [clearToken, loading, setToken, token, userId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
