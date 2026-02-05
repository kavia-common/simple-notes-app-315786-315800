import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  createNote,
  deleteNote,
  getConfiguredApiBaseUrl,
  listNotes,
  updateNote,
} from "./apiClient";

function normalizeNote(raw) {
  // The backend shape is unknown; normalize conservatively.
  const id = raw?.id ?? raw?._id ?? raw?.noteId ?? raw?.uuid;
  return {
    id,
    title: raw?.title ?? "",
    content: raw?.content ?? "",
    createdAt: raw?.createdAt ?? raw?.created_at ?? null,
    updatedAt: raw?.updatedAt ?? raw?.updated_at ?? null,
  };
}

function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function makeTempId() {
  return `temp_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

// PUBLIC_INTERFACE
function App() {
  /** Notes app main UI: list on the left, editor/details on the right. */
  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [editorTitle, setEditorTitle] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const titleInputRef = useRef(null);

  const apiBaseUrl = useMemo(() => getConfiguredApiBaseUrl(), []);

  const selectedNote = useMemo(() => {
    return notes.find((n) => String(n.id) === String(selectedId)) || null;
  }, [notes, selectedId]);

  const sortedNotes = useMemo(() => {
    // Prefer updatedAt/createdAt if present, otherwise keep stable by title.
    const copy = [...notes];
    copy.sort((a, b) => {
      const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
      if (bt !== at) return bt - at;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
    return copy;
  }, [notes]);

  async function refreshNotes({ keepSelection = true } = {}) {
    setError("");
    try {
      const data = await listNotes();
      const normalized = (data || []).map(normalizeNote).filter((n) => n.id != null);
      setNotes(normalized);

      if (!keepSelection) {
        setSelectedId(normalized[0]?.id ?? null);
        return;
      }

      if (selectedId == null && normalized.length > 0) {
        setSelectedId(normalized[0].id);
      } else if (selectedId != null) {
        const stillExists = normalized.some((n) => String(n.id) === String(selectedId));
        if (!stillExists) setSelectedId(normalized[0]?.id ?? null);
      }
    } catch (e) {
      setError(e?.message || "Failed to load notes.");
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoading(true);
      await refreshNotes({ keepSelection: true });
      if (mounted) setIsLoading(false);
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selection changes, load note into editor
  useEffect(() => {
    setInfo("");
    setError("");

    if (!selectedNote) {
      setEditorTitle("");
      setEditorContent("");
      setIsDirty(false);
      return;
    }

    setEditorTitle(selectedNote.title || "");
    setEditorContent(selectedNote.content || "");
    setIsDirty(false);
  }, [selectedNote]);

  function onSelectNote(id) {
    if (isDirty && selectedId != null && String(id) !== String(selectedId)) {
      const ok = window.confirm("You have unsaved changes. Discard them and switch notes?");
      if (!ok) return;
    }
    setSelectedId(id);
  }

  async function onNewNote() {
    setError("");
    setInfo("");

    if (isDirty && selectedId != null) {
      const ok = window.confirm("You have unsaved changes. Discard them and create a new note?");
      if (!ok) return;
    }

    // Create immediately on backend (simplest UX; avoids local-only state drift).
    setIsSaving(true);
    try {
      const created = await createNote({ title: "Untitled", content: "" });
      const normalized = normalizeNote(created || {});
      // If backend didn't return note, refresh list.
      if (normalized.id == null) {
        await refreshNotes({ keepSelection: false });
      } else {
        setNotes((prev) => [normalized, ...prev]);
        setSelectedId(normalized.id);
      }
      setEditorTitle("Untitled");
      setEditorContent("");
      setIsDirty(true); // treat as draft until user saves edits
      setInfo("New note created.");
      // Focus title for quick editing.
      setTimeout(() => titleInputRef.current?.focus(), 0);
    } catch (e) {
      setError(e?.message || "Failed to create note.");
    } finally {
      setIsSaving(false);
    }
  }

  async function onSave() {
    if (!selectedNote?.id) return;

    setError("");
    setInfo("");
    setIsSaving(true);

    try {
      const payload = {
        title: editorTitle.trim() || "Untitled",
        content: editorContent,
      };

      const updated = await updateNote(selectedNote.id, payload);
      const normalized = normalizeNote(updated || {});
      if (normalized.id == null) {
        // If backend doesn't return updated note, just refresh.
        await refreshNotes({ keepSelection: true });
      } else {
        setNotes((prev) =>
          prev.map((n) => (String(n.id) === String(normalized.id) ? { ...n, ...normalized } : n))
        );
      }
      setIsDirty(false);
      setInfo("Saved.");
    } catch (e) {
      setError(e?.message || "Failed to save note.");
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete() {
    if (!selectedNote?.id) return;

    setError("");
    setInfo("");
    const ok = window.confirm("Delete this note? This cannot be undone.");
    if (!ok) return;

    setIsDeleting(true);
    try {
      await deleteNote(selectedNote.id);
      setNotes((prev) => prev.filter((n) => String(n.id) !== String(selectedNote.id)));
      setSelectedId((prevSelected) => {
        if (String(prevSelected) !== String(selectedNote.id)) return prevSelected;
        const remaining = notes.filter((n) => String(n.id) !== String(selectedNote.id));
        return remaining[0]?.id ?? null;
      });
      setIsDirty(false);
      setInfo("Deleted.");
    } catch (e) {
      setError(e?.message || "Failed to delete note.");
    } finally {
      setIsDeleting(false);
    }
  }

  function onEditorTitleChange(v) {
    setEditorTitle(v);
    setIsDirty(true);
  }

  function onEditorContentChange(v) {
    setEditorContent(v);
    setIsDirty(true);
  }

  const disableActions = isLoading || isSaving || isDeleting;

  return (
    <div className="App">
      <header className="appHeader">
        <div className="appHeaderLeft">
          <div className="appTitleRow">
            <h1 className="appTitle">Notes</h1>
            <span className="appBadge">Simple</span>
          </div>
          <div className="appSubtitle">
            Create, edit, and delete notes. No login required.
          </div>
        </div>

        <div className="appHeaderRight">
          <button
            type="button"
            className="btn btnPrimary"
            onClick={onNewNote}
            disabled={disableActions}
          >
            New note
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => refreshNotes({ keepSelection: true })}
            disabled={disableActions}
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="appMain" aria-busy={isLoading ? "true" : "false"}>
        <section className="panel panelLeft" aria-label="Notes list">
          <div className="panelHeader">
            <div className="panelTitle">Your notes</div>
            <div className="panelMeta">
              {sortedNotes.length} note{sortedNotes.length === 1 ? "" : "s"}
            </div>
          </div>

          {isLoading ? (
            <div className="emptyState">
              <div className="emptyTitle">Loading…</div>
              <div className="emptyDesc">Fetching notes from the backend.</div>
            </div>
          ) : sortedNotes.length === 0 ? (
            <div className="emptyState">
              <div className="emptyTitle">No notes yet</div>
              <div className="emptyDesc">Create your first note to get started.</div>
              <button
                type="button"
                className="btn btnPrimary"
                onClick={onNewNote}
                disabled={disableActions}
              >
                Create a note
              </button>
            </div>
          ) : (
            <ul className="notesList">
              {sortedNotes.map((n) => {
                const isSelected = selectedId != null && String(n.id) === String(selectedId);
                return (
                  <li key={String(n.id)}>
                    <button
                      type="button"
                      className={`noteListItem ${isSelected ? "selected" : ""}`}
                      onClick={() => onSelectNote(n.id)}
                    >
                      <div className="noteListTitle">{n.title || "Untitled"}</div>
                      <div className="noteListPreview">
                        {(n.content || "").trim().slice(0, 90) || "No content"}
                      </div>
                      <div className="noteListTime">
                        {formatTimestamp(n.updatedAt || n.createdAt)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="panelFooter">
            <div className="envHint">
              API: <code>{apiBaseUrl || "(same origin)"}</code>
            </div>
          </div>
        </section>

        <section className="panel panelRight" aria-label="Note editor">
          <div className="panelHeader">
            <div className="panelTitle">
              {selectedNote ? "Editor" : "Select a note"}
            </div>
            <div className="panelActions">
              <button
                type="button"
                className="btn btnPrimary"
                onClick={onSave}
                disabled={!selectedNote || !isDirty || disableActions}
                aria-disabled={!selectedNote || !isDirty || disableActions}
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btnDanger"
                onClick={onDelete}
                disabled={!selectedNote || disableActions}
                aria-disabled={!selectedNote || disableActions}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="callout calloutError" role="alert">
              {error}
            </div>
          ) : null}

          {info ? (
            <div className="callout calloutInfo" role="status">
              {info}
            </div>
          ) : null}

          {!selectedNote ? (
            <div className="emptyState">
              <div className="emptyTitle">No note selected</div>
              <div className="emptyDesc">
                Choose a note from the list, or create a new one.
              </div>
              <button
                type="button"
                className="btn btnPrimary"
                onClick={onNewNote}
                disabled={disableActions}
              >
                New note
              </button>
            </div>
          ) : (
            <form
              className="editor"
              onSubmit={(e) => {
                e.preventDefault();
                onSave();
              }}
            >
              <label className="field">
                <div className="fieldLabel">Title</div>
                <input
                  ref={titleInputRef}
                  className="input"
                  type="text"
                  value={editorTitle}
                  onChange={(e) => onEditorTitleChange(e.target.value)}
                  placeholder="Untitled"
                  disabled={disableActions}
                />
              </label>

              <label className="field">
                <div className="fieldLabel">Content</div>
                <textarea
                  className="textarea"
                  value={editorContent}
                  onChange={(e) => onEditorContentChange(e.target.value)}
                  placeholder="Write your note…"
                  rows={14}
                  disabled={disableActions}
                />
              </label>

              <div className="editorMeta">
                <div className="metaItem">
                  <span className="metaLabel">Note ID:</span>{" "}
                  <code>{String(selectedNote.id || "")}</code>
                </div>
                {selectedNote.updatedAt || selectedNote.createdAt ? (
                  <div className="metaItem">
                    <span className="metaLabel">Last updated:</span>{" "}
                    {formatTimestamp(selectedNote.updatedAt || selectedNote.createdAt)}
                  </div>
                ) : null}
                {isDirty ? <div className="dirtyPill">Unsaved changes</div> : null}
              </div>

              <div className="editorFooter">
                <button
                  type="submit"
                  className="btn btnPrimary"
                  disabled={!isDirty || disableActions}
                >
                  {isSaving ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!isDirty || disableActions}
                  onClick={() => {
                    const ok = window.confirm("Discard unsaved changes?");
                    if (!ok) return;
                    setEditorTitle(selectedNote.title || "");
                    setEditorContent(selectedNote.content || "");
                    setIsDirty(false);
                    setInfo("Changes discarded.");
                  }}
                >
                  Discard
                </button>
              </div>
            </form>
          )}
        </section>
      </main>

      <footer className="appFooter">
        <div className="footerLeft">
          <span className="footerText">
            Backend wiring uses <code>REACT_APP_API_BASE</code> / <code>REACT_APP_BACKEND_URL</code>.
          </span>
        </div>
        <div className="footerRight">
          <a className="footerLink" href="https://react.dev" target="_blank" rel="noreferrer">
            React
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
