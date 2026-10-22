// 侧栏「＋ 新建频道」：登录人类直接在页面建频道，选公开（粉丝可进）或私有（联调项目，仅自己账号可进），
// 可勾选头脑风暴（party 模式，loop guard 放宽到 200）。建成即跳转。scoped/readonly token 不显示此入口。
import { useCallback, useState } from "react";
import {
  AuthError,
  ConflictError,
  createChannel,
  ForbiddenError,
  ValidationError,
  type Visibility,
} from "../lib/api";
import { forbiddenText } from "../lib/forbidden";
import { useT } from "../i18n/useT";
import "../i18n/strings/CreateChannel";

interface Props {
  token: string;
  onCreated(slug: string): void;
}

const VIS_OPTIONS: readonly Visibility[] = ["private", "public_watch", "public"];

export function CreateChannel({ token, onCreated }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [party, setParty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTitle("");
    setVisibility("private");
    setParty(false);
    setErr(null);
  }, []);

  const submit = useCallback(async () => {
    const name = title.trim();
    if (name.length === 0 || name.length > 80) {
      setErr(t("CreateChannel.nameInvalid"));
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const created = await createChannel(token, {
        title: name,
        visibility,
        mode: party ? "party" : "normal",
      });
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(created.slug)) {
        throw new Error("invalid generated channel identifier");
      }
      setBusy(false);
      setOpen(false);
      reset();
      onCreated(created.slug);
    } catch (e) {
      setBusy(false);
      setErr(
        e instanceof ConflictError
          ? t("CreateChannel.errConflict")
          : e instanceof ForbiddenError
            ? forbiddenText(e, t, "CreateChannel.errForbidden")
            : e instanceof ValidationError
              ? t("CreateChannel.errValidation")
              : e instanceof AuthError
                ? t("CreateChannel.errAuth")
                : t("CreateChannel.errGeneric"),
      );
    }
  }, [title, visibility, party, token, onCreated, reset, t]);

  if (!open) {
    return (
      <button
        type="button"
        className="d-pill chan-pill newchan-open"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <span className="chan-head">
          <span className="newchan-plus">＋</span>
          <span className="chan-name">{t("CreateChannel.new")}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="d-card newchan-card">
      <label className="newchan-name-label" htmlFor="newchan-name">
        {t("CreateChannel.nameLabel")}
      </label>
      <input
        id="newchan-name"
        className="newchan-input"
        autoFocus
        maxLength={80}
        value={title}
        placeholder={t("CreateChannel.titlePlaceholder")}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        disabled={busy}
      />
      <p className="newchan-help" id="newchan-identifier-help">{t("CreateChannel.generatedHint")}</p>
      <div className="newchan-opts">
        <label className="newchan-seg">
          <span className="t-mono newchan-segk">{t("CreateChannel.visibilityLabel")}</span>
          {VIS_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={"newchan-choice" + (visibility === opt ? " is-on" : "")}
              onClick={() => setVisibility(opt)}
              disabled={busy}
              aria-pressed={visibility === opt}
            >
              {t(`CreateChannel.vis.${opt}`)}
            </button>
          ))}
        </label>
        <label className="newchan-check">
          <input
            type="checkbox"
            checked={party}
            onChange={(e) => setParty(e.target.checked)}
            disabled={busy}
          />
          <span>{t("CreateChannel.party")}</span>
        </label>
      </div>
      <p className="newchan-help t-mono">{t(`CreateChannel.help.${visibility}`)}</p>
      {err !== null && (
        <p className="banner banner--red newchan-err" role="alert">
          {err}
        </p>
      )}
      <div className="newchan-actions">
        <button
          type="button"
          className="d-btn newchan-cancel"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={busy}
        >
          {t("CreateChannel.cancel")}
        </button>
        <button type="button" className="d-btn d-btn--primary" onClick={submit} disabled={busy || !title.trim()}>
          {busy ? t("CreateChannel.creating") : t("CreateChannel.create")}
        </button>
      </div>
    </div>
  );
}
