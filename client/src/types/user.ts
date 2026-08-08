export interface UserProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** Custom field, GitHub-only — see server/auth.mjs's mapProfileToUser. */
  githubLogin: string | null;
}
