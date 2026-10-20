// Frontend → backend wiring.
//
// Same-origin by default (empty string) — correct when the API serves this
// page, or when Vercel rewrites /api/* to the backend (see vercel.json).
//
// If you host the frontend on Vercel and the backend elsewhere WITHOUT a
// rewrite, set the backend's public URL here, e.g.:
//   window.POCKET_API = "https://pocket-tools-api.up.railway.app";
window.POCKET_API = "";
