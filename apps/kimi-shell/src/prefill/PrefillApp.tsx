import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getInitialThemeMode } from "@/app/theme";
import type { SubmitPrefillAck } from "@/app/types";
import { Button } from "@/components/ui/button";

const MAX_PREFILL_CHARS = 8000;

export function PrefillApp() {
  const themeMode = useMemo(() => getInitialThemeMode(), []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await invoke<SubmitPrefillAck>("submit_prefill", { text });
    } catch (invokeError) {
      setError(String(invokeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`prefill-page theme-${themeMode}`}>
      <section className="prefill-dialog" role="dialog" aria-modal="true">
        <header className="prefill-header">
          <h1>预填聊天内容</h1>
          <p>提交后会打开主窗口并自动填入、自动发送。</p>
        </header>

        <div className="prefill-body">
          <label htmlFor="prefill-text">内容</label>
          <textarea
            id="prefill-text"
            className="ui-input prefill-textarea"
            value={text}
            maxLength={MAX_PREFILL_CHARS}
            autoFocus
            placeholder="输入要发送给 Kimi 的内容..."
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <p className="prefill-counter">
            {text.length}/{MAX_PREFILL_CHARS}
          </p>
          {error ? <p className="prefill-error">{error}</p> : null}
        </div>

        <footer className="prefill-footer">
          <Button
            type="button"
            variant="default"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={busy}
          >
            {busy ? "提交中..." : "提交并打开主窗口"}
          </Button>
          <span className="prefill-hint">快捷键：Ctrl/Cmd + Enter</span>
        </footer>
      </section>
    </main>
  );
}
