const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Choose the best available API base URL from the provided env vars.
 * - Prefer REACT_APP_API_BASE if present.
 * - Fall back to REACT_APP_BACKEND_URL.
 * - As a last resort, use same-origin (empty string).
 */
function getApiBaseUrl() {
  const raw =
    process.env.REACT_APP_API_BASE ||
    process.env.REACT_APP_BACKEND_URL ||
    "";
  return String(raw || "").replace(/\/+$/, "");
}

function buildUrl(path) {
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

async function parseJsonOrThrow(response) {
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    let detail = "";
    try {
      detail = isJson ? JSON.stringify(await response.json()) : await response.text();
    } catch (e) {
      detail = "";
    }
    const message = detail ? `Request failed (${response.status}): ${detail}` : `Request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  if (response.status === 204) return null;
  if (isJson) return response.json();

  // Backend should be JSON; but tolerate empty/non-json responses for resilience.
  const text = await response.text();
  return text ? { raw: text } : null;
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(buildUrl(path), {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    return await parseJsonOrThrow(res);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Try multiple common notes API shapes to maximize compatibility.
 * This template does not include backend code/spec in the workspace, so we support:
 *  - /notes (GET/POST), /notes/:id (PUT/DELETE)
 *  - /api/notes (GET/POST), /api/notes/:id (PUT/DELETE)
 */
const NOTES_BASE_CANDIDATES = ["/notes", "/api/notes"];

// PUBLIC_INTERFACE
export async function listNotes() {
  /** List notes. Returns array of {id, title, content, updatedAt?, createdAt?}. */
  let lastErr;
  for (const base of NOTES_BASE_CANDIDATES) {
    try {
      const data = await request(base, { method: "GET" });
      // Accept either array directly or {notes: [...]}
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.notes)) return data.notes;
      return [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// PUBLIC_INTERFACE
export async function createNote(note) {
  /** Create a note with {title, content}. Returns created note. */
  let lastErr;
  for (const base of NOTES_BASE_CANDIDATES) {
    try {
      return await request(base, { method: "POST", body: JSON.stringify(note) });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// PUBLIC_INTERFACE
export async function updateNote(id, note) {
  /** Update a note by id using {title, content}. Returns updated note. */
  let lastErr;
  for (const base of NOTES_BASE_CANDIDATES) {
    try {
      return await request(`${base}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(note),
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// PUBLIC_INTERFACE
export async function deleteNote(id) {
  /** Delete a note by id. Returns null/response. */
  let lastErr;
  for (const base of NOTES_BASE_CANDIDATES) {
    try {
      return await request(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// PUBLIC_INTERFACE
export function getConfiguredApiBaseUrl() {
  /** Return the resolved API base URL for display/debugging. */
  return getApiBaseUrl();
}
