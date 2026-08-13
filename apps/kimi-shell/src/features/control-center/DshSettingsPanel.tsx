import { useEffect, useState } from "react";
import { Download, FileText, RefreshCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ControlCenterToggleField } from "@/components/control-center/ControlCenterToggleField";
import {
  getDshLogTail,
  getDshPreflight,
  getDshSettings,
  getDshStatus,
  installDsh,
  saveDshSettings,
  stopDsh,
  type DshPreflight,
  type DshSettings,
  type DshStatus,
} from "@/services/dshService";

export function DshSettingsPanel() {
  const [settings, setSettings] = useState<DshSettings | null>(null);
  const [preflight, setPreflight] = useState<DshPreflight | null>(null);
  const [status, setStatus] = useState<DshStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const [nextSettings, nextPreflight, nextStatus] = await Promise.all([
        getDshSettings(),
        getDshPreflight(),
        getDshStatus(),
      ]);
      setSettings(nextSettings);
      setPreflight(nextPreflight);
      setStatus(nextStatus);
    } catch (cause) {
      setError(formatError(cause));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggle(enabled: boolean) {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      setSettings(
        await saveDshSettings({
          enabled,
          portRange: settings.portRange,
          startTimeoutSec: settings.startTimeoutSec,
        }),
      );
      setStatus(await getDshStatus());
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    setBusy(true);
    setError(null);
    try {
      setPreflight(await installDsh());
    } catch (cause) {
      setError(formatError(cause));
      setLogs(await getDshLogTail().catch(() => []));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cc-settings-group" aria-label="DeepSeek Harness">
      <div className="cc-settings-group-title">
        <h2>实验性后端</h2>
      </div>
      <div className="cc-settings-bar-detail cc-dsh-settings">
        <ControlCenterToggleField
          label="DeepSeek Harness"
          description={`本地 Web 工作台 · 固定版本 ${settings?.pinnedVersion ?? "检测中"}；关闭会先停止当前实例。`}
          checked={settings?.enabled === true}
          disabled={!settings}
          busy={busy}
          onChange={(enabled) => void toggle(enabled)}
        />
        <div className="cc-settings-live-row" aria-live="polite">
          {preflight?.ready
            ? `已就绪 · Node ${preflight.nodeVersion ?? "已检测"} · DSH ${preflight.installedVersion}`
            : preflight?.issues.join(" ") ?? "正在检测 Node 与 DSH 私有安装…"}
        </div>
        <p className="hint">
          运行状态：{formatState(status?.state)}。API key 与工作区权限在 DSH 自身界面中管理；小助手不会读取或写入其凭据。
        </p>
        {error ? <p className="cc-config-error">{error}</p> : null}
        <div className="cc-step-secondary-actions">
          <Button
            type="button"
            variant="outline"
            icon={<Download size={14} />}
            className="cc-action-btn"
            disabled={busy || !preflight?.npmPath}
            onClick={() => void install()}
          >
            {busy ? "处理中" : preflight?.ready ? "重新安装固定版本" : "安装固定版本"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCcw size={14} />}
            className="cc-action-btn"
            disabled={busy}
            onClick={() => void refresh()}
          >
            重新检测
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<FileText size={14} />}
            className="cc-action-btn"
            onClick={() => void getDshLogTail().then(setLogs)}
          >
            查看日志尾部
          </Button>
          {status?.state === "running" || status?.state === "starting" ? (
            <Button
              type="button"
              variant="outline"
              icon={<Square size={13} />}
              className="cc-action-btn"
              disabled={busy}
              onClick={() =>
                void stopDsh()
                  .then(setStatus)
                  .catch((cause) => setError(formatError(cause)))
              }
            >
              停止实例
            </Button>
          ) : null}
        </div>
        {logs.length > 0 ? <pre className="cc-app-update-notes">{logs.join("\n")}</pre> : null}
      </div>
    </section>
  );
}

function formatState(state?: DshStatus["state"]) {
  if (state === "starting") return "正在启动";
  if (state === "running") return "运行中";
  if (state === "stopping") return "正在停止";
  if (state === "crashed") return "异常退出";
  return "已停止";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
