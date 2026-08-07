import { useEffect, useState } from "react";

export interface UserProfile {
  id: string;
  githubId: number;
  githubLogin: string;
  avatarUrl: string;
}

export function UserNav() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore
    }
    setUser(null);
    window.location.reload();
  };

  if (loading) {
    return <span style={{ fontSize: "0.85rem", color: "#666" }}>Checking session...</span>;
  }

  if (!user) {
    return (
      <a
        href="/api/auth/github"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 1rem",
          background: "#24292e",
          color: "#ffffff",
          textDecoration: "none",
          borderRadius: "4px",
          fontWeight: "600",
          fontSize: "0.85rem",
          cursor: "pointer",
        }}
      >
        <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        Sign in with GitHub
      </a>
    );
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem" }}>
      <img
        src={user.avatarUrl}
        alt={user.githubLogin}
        style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid #ccc" }}
      />
      <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#333" }}>{user.githubLogin}</span>
      <button
        onClick={handleLogout}
        style={{
          padding: "0.3rem 0.6rem",
          fontSize: "0.8rem",
          background: "transparent",
          border: "1px solid #d32f2f",
          color: "#d32f2f",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
