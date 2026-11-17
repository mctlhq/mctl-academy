// Types for spaRoutes.mjs (plain JavaScript so the server can import it).
export const STATIC_SPA_PATHS: readonly string[];
export const COURSE_PATH_PREFIX: string;
export const NOINDEX_PATH_PREFIXES: readonly string[];
export function isNoindexRoute(path?: string): boolean;
