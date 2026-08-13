import { useState } from "react";
import { Button } from "@/components/ui/button";

export const MAC_KIMI_INSTALL_COMMAND =
  "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash";
export const MAC_KIMI_UPGRADE_COMMAND = MAC_KIMI_INSTALL_COMMAND;

type MacKimiInstallGuidanceProps = {
  onOpenTerminal: () => Promise<void>;
  onOpenDocs: () => Promise<void>;
};

export function MacKimiInstallGuidance({
  onOpenTerminal,
  onOpenDocs,
}: MacKimiInstallGuidanceProps) {
  const [feedback, setFeedback] = useState("");

  async function copyCommand(command: string, label: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(command);
      setFeedback(`已复制${label}`);
    } catch {
      setFeedback("复制失败，请手动选择上方命令。");
    }
  }

  async function openTerminal() {
    try {
      await onOpenTerminal();
      setFeedback("已打开 Terminal；请粘贴已复制的命令并自行确认执行。");
    } catch {
      setFeedback("无法打开 Terminal，请从“应用程序 > 实用工具”手动打开。");
    }
  }

  return (
    <div className="cc-config-grid">
      <p className="hint">
        小助手不会自动执行远程脚本。复制官方命令，在 Terminal 中确认执行，完成后回到这里重新检测。
      </p>
      <pre className="cc-install-command-code">{MAC_KIMI_INSTALL_COMMAND}</pre>
      <div className="cc-step-secondary-actions">
        <Button
          type="button"
          variant="ghost"
          className="cc-action-btn"
          onClick={() => void copyCommand(MAC_KIMI_INSTALL_COMMAND, "安装命令")}
        >
          复制安装命令
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="cc-action-btn"
          onClick={() => void copyCommand(MAC_KIMI_UPGRADE_COMMAND, "升级命令")}
        >
          复制升级命令
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="cc-action-btn"
          onClick={() => void openTerminal()}
        >
          打开 Terminal
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="cc-action-btn"
          onClick={() => void onOpenDocs()}
        >
          打开官方文档
        </Button>
      </div>
      {feedback ? (
        <p className="hint" role="status" aria-live="polite">
          {feedback}
        </p>
      ) : null}
      <p className="hint">
        默认安装位置为 ~/.kimi-code/bin/kimi；其他可信安装可通过“选择 Kimi 路径”指定。
      </p>
    </div>
  );
}
