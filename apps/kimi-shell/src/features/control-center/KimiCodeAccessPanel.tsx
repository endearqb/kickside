import { Check, Eye, EyeOff, FolderOpen, Trash2, Wifi } from "lucide-react";
import { useState } from "react";
import type {
  KimiCodeAccessConfigInput,
  KimiCodeAccessConfigTestResult,
  KimiCodeAccessConfigView,
  KimiCodeAccessServiceApiKeyMode,
} from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type KimiCodeAccessTaskContentProps = {
  dirty: boolean;
  view: KimiCodeAccessConfigView | null;
  draft: KimiCodeAccessConfigInput;
  testResult: KimiCodeAccessConfigTestResult | null;
  testing: boolean;
  saving: boolean;
  onDraftChange: (next: KimiCodeAccessConfigInput) => void;
  onSave: () => Promise<void>;
  onOpenConfigDir: () => Promise<void>;
  onTestConnection: () => Promise<void>;
};

type SecretField = "provider" | "search" | "fetch";

function normalizeUrl(value: string): string {
  return value.trim();
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function modeLabel(mode: KimiCodeAccessServiceApiKeyMode | undefined): string {
  switch (mode) {
    case "custom":
      return "单独配置";
    case "keep_existing":
      return "保留现有";
    case "clear":
      return "清除";
    case "reuse_provider":
    default:
      return "复用 Kimi API Key";
  }
}

export function buildBlockingErrors(draft: KimiCodeAccessConfigInput): string[] {
  const errors: string[] = [];
  if (!normalizeUrl(draft.providerBaseUrl)) {
    errors.push("Kimi API Base URL 不能为空");
  } else if (!isValidHttpUrl(draft.providerBaseUrl)) {
    errors.push("Kimi API Base URL 必须是合法 http/https URL");
  }
  if (!normalizeUrl(draft.searchBaseUrl)) {
    errors.push("Search Service Base URL 不能为空");
  } else if (!isValidHttpUrl(draft.searchBaseUrl)) {
    errors.push("Search Service Base URL 必须是合法 http/https URL");
  }
  if (!normalizeUrl(draft.fetchBaseUrl)) {
    errors.push("Fetch Service Base URL 不能为空");
  } else if (!isValidHttpUrl(draft.fetchBaseUrl)) {
    errors.push("Fetch Service Base URL 必须是合法 http/https URL");
  }
  if (draft.searchApiKeyMode === "custom" && !draft.searchApiKey?.trim()) {
    errors.push("Search Service 单独配置时必须填写 API Key");
  }
  if (draft.fetchApiKeyMode === "custom" && !draft.fetchApiKey?.trim()) {
    errors.push("Fetch Service 单独配置时必须填写 API Key");
  }
  if (
    draft.agentSwarmMaxConcurrency != null &&
    (!Number.isInteger(draft.agentSwarmMaxConcurrency) ||
      draft.agentSwarmMaxConcurrency <= 0)
  ) {
    errors.push("子 Agent 并发上限必须是正整数");
  }
  return errors;
}

export function buildWarnings(
  draft: KimiCodeAccessConfigInput,
  serverWarnings: string[] = [],
): string[] {
  const warnings = [...serverWarnings];
  if (draft.clearProviderApiKey) {
    warnings.push("保存后会清除 Kimi API Key。");
  }
  if (draft.searchApiKeyMode === "clear") {
    warnings.push("保存后会清除 Search Service API Key。");
  }
  if (draft.fetchApiKeyMode === "clear") {
    warnings.push("保存后会清除 Fetch Service API Key。");
  }
  return warnings;
}

export function KimiCodeAccessTaskContent({
  dirty,
  view,
  draft,
  testResult,
  testing,
  saving,
  onDraftChange,
  onSave,
  onOpenConfigDir,
  onTestConnection,
}: KimiCodeAccessTaskContentProps) {
  const [visibleSecrets, setVisibleSecrets] = useState<Record<SecretField, boolean>>({
    provider: false,
    search: false,
    fetch: false,
  });
  const [expandedSections, setExpandedSections] = useState<
    Partial<Record<"search" | "fetch", boolean>>
  >({});
  const blockingErrors = buildBlockingErrors(draft);

  function updateDraft(patch: Partial<KimiCodeAccessConfigInput>) {
    onDraftChange({ ...draft, ...patch });
  }

  function secretInputType(field: SecretField) {
    return visibleSecrets[field] ? "text" : "password";
  }

  function toggleSecret(field: SecretField) {
    setVisibleSecrets((current) => ({ ...current, [field]: !current[field] }));
  }

  function renderSecretActions(field: SecretField, onClear: () => void) {
    return (
      <div className="cc-actions compact">
        <Button
          type="button"
          variant="outline"
          className="cc-icon-btn"
          icon={visibleSecrets[field] ? <EyeOff size={14} /> : <Eye size={14} />}
          onClick={() => toggleSecret(field)}
          title={visibleSecrets[field] ? "隐藏" : "显示"}
          aria-label={visibleSecrets[field] ? "隐藏" : "显示"}
        />
        <Button
          type="button"
          variant="outline"
          className="cc-icon-btn danger"
          icon={<Trash2 size={14} />}
          onClick={onClear}
          title="清除"
          aria-label="清除"
        />
      </div>
    );
  }

  function renderService(
    label: string,
    field: "search" | "fetch",
    serviceKey: "moonshot_search" | "moonshot_fetch",
    baseUrlKey: "searchBaseUrl" | "fetchBaseUrl",
    modeKey: "searchApiKeyMode" | "fetchApiKeyMode",
    apiKeyKey: "searchApiKey" | "fetchApiKey",
  ) {
    const mode = draft[modeKey] ?? "reuse_provider";
    const serviceView = view?.services[field];
    return (
      <details
        className="cc-config-disclosure"
        open={expandedSections[field] ?? Boolean(serviceView?.apiKeyConfigured || mode === "custom")}
        onToggle={(event) =>
          setExpandedSections((current) => ({
            ...current,
            [field]: event.currentTarget.open,
          }))
        }
      >
        <summary>
          <span>{label}</span>
          <small>{serviceView?.apiKeyConfigured ? "运行中" : "可选"}</small>
        </summary>
        <div className="cc-config-disclosure-body">
          <p className="hint">Key: {serviceKey}</p>
        <label className="field-stack">
          <span>Base URL</span>
          <Input
            value={draft[baseUrlKey]}
            onChange={(event) => updateDraft({ [baseUrlKey]: event.currentTarget.value })}
          />
        </label>
        <div className="cc-config-radio-row" role="radiogroup" aria-label={`${label} API Key`}>
          {(["reuse_provider", "custom", "keep_existing", "clear"] as const).map((item) => (
            <label key={item} className="cc-config-radio">
              <input
                type="radio"
                checked={mode === item}
                onChange={() => updateDraft({ [modeKey]: item })}
              />
              <span>{modeLabel(item)}</span>
            </label>
          ))}
        </div>
        {mode === "custom" ? (
          <div className="cc-config-inline-secret">
            <Input
              type={secretInputType(field)}
              value={draft[apiKeyKey] ?? ""}
              onChange={(event) =>
                updateDraft({
                  [apiKeyKey]: event.currentTarget.value || undefined,
                })
              }
              placeholder={serviceView?.apiKeyMasked ?? "sk-..."}
            />
            {renderSecretActions(field, () =>
              updateDraft({ [apiKeyKey]: undefined, [modeKey]: "clear" }),
            )}
          </div>
        ) : null}
        {mode === "keep_existing" && serviceView?.apiKeyMasked ? (
          <p className="hint">当前保存值：{serviceView.apiKeyMasked}</p>
        ) : null}
        </div>
      </details>
    );
  }

  return (
    <div className="cc-config-modal-body cc-config-access-layout">
      <div className="cc-config-content">
        <section className="cc-config-panel">
          <div className="cc-config-panel-head">
            <h4>Kimi Code 接入配置</h4>
          </div>
          <div className="cc-config-grid two">
            <label className="field-stack">
              <span>Base URL</span>
              <Input
                value={draft.providerBaseUrl}
                onChange={(event) => updateDraft({ providerBaseUrl: event.currentTarget.value })}
              />
            </label>
            <label className="field-stack">
              <span>API Key</span>
              <div className="cc-config-inline-secret">
                <Input
                  type={secretInputType("provider")}
                  value={draft.providerApiKey ?? ""}
                  onChange={(event) =>
                    updateDraft({
                      providerApiKey: event.currentTarget.value || undefined,
                      clearProviderApiKey: false,
                    })
                  }
                  placeholder={view?.provider.apiKeyMasked ?? "sk-..."}
                />
                {renderSecretActions("provider", () =>
                  updateDraft({ providerApiKey: undefined, clearProviderApiKey: true }),
                )}
              </div>
            </label>
          </div>
          {draft.clearProviderApiKey ? <p className="hint danger">保存后会清除现有 API Key。</p> : null}
        </section>

        <div className="cc-config-grid two">
          {renderService(
            "Web Search（可选）",
            "search",
            "moonshot_search",
            "searchBaseUrl",
            "searchApiKeyMode",
            "searchApiKey",
          )}
          {renderService(
            "Web Fetch（可选）",
            "fetch",
            "moonshot_fetch",
            "fetchBaseUrl",
            "fetchApiKeyMode",
            "fetchApiKey",
          )}
        </div>

        <section className="cc-config-panel">
          <div className="cc-actions wrap">
            <Button
              type="button"
              className="cc-action-btn"
              icon={<Check size={14} />}
              onClick={() => void onSave()}
              disabled={saving || !dirty || blockingErrors.length > 0}
            >
              {saving ? "保存中" : "保存 API 配置"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cc-action-btn"
              icon={<Wifi size={14} />}
              onClick={() => void onTestConnection()}
              disabled={testing}
            >
              {testing ? "测试中" : "测试连接"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cc-action-btn"
              icon={<FolderOpen size={14} />}
              onClick={() => void onOpenConfigDir()}
            >
              打开配置目录
            </Button>
          </div>
          {blockingErrors.length ? (
            <ul className="cc-config-error-list">
              {blockingErrors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          ) : null}
          {view?.configError ? (
            <p className="hint danger">配置文件无法解析：{view.configError}</p>
          ) : null}
          {testResult ? (
            <div className="cc-config-summary-grid">
              {[
                ["Kimi API", testResult.provider],
                ["Search", testResult.search],
                ["Fetch", testResult.fetch],
              ].map(([label, result]) => {
                const item = result as KimiCodeAccessConfigTestResult["provider"];
                return (
                  <article key={label as string} className="cc-config-summary-card">
                    <span>{label as string}</span>
                    <strong>{item.reachable ? "可达" : "不可达"}</strong>
                    <small>{item.statusCode ? `HTTP ${item.statusCode}` : item.error ?? item.url}</small>
                  </article>
                );
              })}
            </div>
          ) : null}
          {testResult?.warnings.length ? (
            <ul className="cc-config-warning-list">
              {testResult.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}
