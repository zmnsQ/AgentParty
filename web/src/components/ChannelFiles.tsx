import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelFile } from "@agentparty/shared/collaboration";
import type { Attachment } from "@agentparty/shared";
import { uploadAttachment } from "../lib/api";
import { collaborationError, type CollaborationClient } from "../lib/collaborationApi";
import { formatSize, resolveAttachmentDownloadUrl } from "./AttachmentList";
import { collaborationDate } from "./CloudAgentConnections";
import { useT } from "../i18n/useT";
import { useLocale } from "../i18n/locale";
import "../i18n/strings/CollaborationHub";

export function ChannelFiles({ token, slug, canUpload, client, upload = uploadAttachment }: {
  token: string; slug: string; canUpload: boolean; client: CollaborationClient;
  upload?: typeof uploadAttachment;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [files, setFiles] = useState<ChannelFile[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareAfterUpload, setShareAfterUpload] = useState(true);
  const input = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true);
  const operationBusy = useRef(false);
  const generation = useRef(0);
  const postIds = useRef(new Map<string, string>());

  const load = useCallback(async (nextCursor: string | null = null, signal?: AbortSignal) => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await client.files(token, slug, nextCursor, signal);
      if (!alive.current || current !== generation.current) return;
      setFiles((previous) => nextCursor === null ? result.files : [...new Map([...previous, ...result.files].map((file) => [file.key, file])).values()]);
      setCursor(result.cursor);
    } catch (cause) { if (alive.current && !signal?.aborted && current === generation.current) setError(collaborationError(cause)); }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [client, slug, token]);
  useEffect(() => {
    alive.current = true; const controller = new AbortController(); void load(null, controller.signal);
    return () => { alive.current = false; controller.abort(); };
  }, [load]);

  const share = async (attachment: Attachment) => {
    const requestId = postIds.current.get(attachment.key) ?? crypto.randomUUID();
    postIds.current.set(attachment.key, requestId);
    const result = await client.shareFile(token, slug, attachment, requestId);
    postIds.current.delete(attachment.key);
    if (alive.current) setNotice(t("Collab.fileShared", { name: attachment.filename, seq: result.seq }));
  };
  const post = async (attachment: Attachment) => {
    if (operationBusy.current || !canUpload) return;
    operationBusy.current = true; setBusy(attachment.key); setError(null); setNotice(null);
    try { await share(attachment); }
    catch (cause) { if (alive.current) setError(collaborationError(cause)); }
    finally { operationBusy.current = false; if (alive.current) setBusy(null); }
  };
  const addFiles = async (picked: File[]) => {
    if (!canUpload || operationBusy.current || picked.length === 0) return;
    operationBusy.current = true; setBusy("upload"); setError(null); setNotice(null);
    const failures: string[] = [];
    for (const file of picked) {
      if (!alive.current) break;
      try {
        const attachment = await upload(token, slug, file);
        if (alive.current) setNotice(t("Collab.fileUploaded", { name: file.name }));
        if (shareAfterUpload) await share(attachment);
      } catch (cause) { failures.push(`${file.name}: ${collaborationError(cause)}`); }
    }
    if (alive.current) {
      await load();
      if (failures.length > 0) setError(failures.join("\n"));
      setBusy(null);
    }
    operationBusy.current = false;
  };
  const download = async (file: ChannelFile) => {
    setError(null);
    try {
      const resolved = await resolveAttachmentDownloadUrl(token, file.url);
      if (!alive.current) { if (resolved.revoke) URL.revokeObjectURL(resolved.href); return; }
      const anchor = document.createElement("a");
      anchor.href = resolved.href; anchor.download = file.filename; anchor.rel = "noreferrer";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      if (resolved.revoke) setTimeout(() => URL.revokeObjectURL(resolved.href), 10_000);
    } catch (cause) { if (alive.current) setError(collaborationError(cause)); }
  };
  const query = search.trim().toLocaleLowerCase();
  const visible = files.filter((file) => file.filename.toLocaleLowerCase().includes(query));
  return <section>
    <div className="commons-section-head"><h2>{t("Collab.files")}</h2><button className="d-btn" type="button" disabled={loading || busy !== null} onClick={() => { setError(null); void load(); }}>{t(loading ? "Collab.loading" : "Collab.refresh")}</button></div>
    <p className="commons-muted">{t("Collab.fileHint")}</p>
    {canUpload && <div className={`commons-dropzone ${busy === "upload" ? "is-busy" : ""}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy === null ? "copy" : "none"; }} onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}>
      <span className="commons-empty-symbol" aria-hidden="true">↑</span><p>{t("Collab.fileDrop")}</p>
      <input ref={input} type="file" multiple hidden disabled={busy !== null} onChange={(event) => { const picked = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addFiles(picked); }} />
      <button className="d-btn commons-primary" type="button" disabled={busy !== null} onClick={() => input.current?.click()}>{t(busy === "upload" ? "Collab.busy" : "Collab.fileUpload")}</button>
      <label className="commons-check"><input type="checkbox" checked={shareAfterUpload} disabled={busy !== null} onChange={(event) => setShareAfterUpload(event.target.checked)} />{t("Collab.fileShareOption")}</label>
    </div>}
    {error && <p className="commons-error" role="alert">{error}</p>}{notice && <p className="commons-success" role="status">{notice}</p>}
    <div className="commons-section-head"><label className="commons-search"><span className="commons-muted">{t("Collab.fileSearch")}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className="commons-muted">{t("Collab.loadedCount", { count: files.length })}</span></div>
    {!loading && !error && visible.length === 0 && <p className="commons-empty">{t(query ? "Collab.fileNoMatch" : "Collab.fileEmpty")}</p>}
    <div className="commons-file-list">{visible.map((file) => <article key={file.key} className="commons-file">
      <div className="commons-file-icon" aria-hidden="true">{file.filename.split(".").pop()?.slice(0, 5).toUpperCase() || "FILE"}</div>
      <div className="commons-file-meta"><strong>{file.filename}</strong><span>{t("Collab.fileSize", { size: formatSize(file.size), date: collaborationDate(file.uploaded_at, locale) })}{file.uploaded_by ? ` · ${file.uploaded_by}` : ""}</span></div>
      <div className="commons-actions"><button className="d-btn" type="button" onClick={() => void download(file)}>{t("Collab.fileDownload")}</button>{canUpload && <button className="d-btn" type="button" disabled={busy !== null} onClick={() => void post(file)}>{t(busy === file.key ? "Collab.busy" : "Collab.fileShare")}</button>}</div>
    </article>)}</div>
    {cursor && <button className="d-btn commons-load-more" type="button" disabled={loading || busy !== null} onClick={() => void load(cursor)}>{t(loading ? "Collab.loading" : "Collab.loadMore")}</button>}
  </section>;
}
