import { Eye, EyeOff, FolderOpen, RotateCcw, Trash2, Wifi } from "lucide-react";
import { useState } from "react";
import type {
  KimiCodeAccessConfigInput,
  KimiCodeAccessConfigTestResult,
  KimiCodeAccessConfigView,
  KimiCodeAccessServiceApiKeyMode,
} from "@/app/types";
import { ControlCenterDescList } from "@/components/control-center/ControlCenterDescList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DEFAULT_PROVIDER_BASE_URL = "https://api.kimi.com/coding/v1";
const DEFAULT_SEARCH_BASE_URL = "https://api.kimi.com/coding/v1/search";
const DEFAULT_FETCH_BASE_URL = "https://api.kimi.com/coding/v1/fetch";

type KimiCodeAccessTaskContentProps = {
  dirty: boolean;
  view: KimiCodeAccessConfigView | null;
  draft: KimiCodeAccessConfigInput;
  testResult: KimiCodeAccessConfigTestResult | null;
  testing: boolean;
  onDraftChange: (next: KimiCodeAccessConfigInput) => void;
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

function parsePositiveInteger(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
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
  onDraftChange,
  onOpenConfigDir,
  onTestConnection,
}: KimiCodeAccessTaskContentProps) {
  const [visibleSecrets, setVisibleSecrets] = useState<Record<SecretField, boolean>>({
    provider: false,
    search: false,
    fetch: false,
  });

  function updateDraft(patch: Partial<KimiCodeAccessConfigInput>) {
    onDraftChange({ ...draft, ...patch });
  }

  function resetDefaultUrls() {
    updateDraft({
      providerBaseUrl: DEFAULT_PROVIDER_BASE_URL,
      searchBaseUrl: DEFAULT_SEARCH_BASE_URL,
      fetchBaseUrl: DEFAULT_FETCH_BASE_URL,
    });
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
      <section className="cc-config-panel">
        <div className="cc-config-panel-head">
          <div>
            <h4>{label}</h4>
            <p className="hint">Key: {serviceKey}</p>
          </div>
          <span className={`status-pill ${serviceView?.apiKeyConfigured ? "success" : "muted"}`}>
            {serviceView?.apiKeyConfigured ? "已配置" : "未配置"}
          </span>
        </div>
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
      </section>
    );
  }

  return (
    <div className="cc-config-modal-body cc-config-access-layout">
      <div className="cc-config-content">
        <section className="cc-config-panel cc-config-summary-panel">
          <div className="cc-config-panel-head">
            <div>
              <h4>配置文件</h4>
            </div>
            <span className={`status-pill ${dirty ? "warning" : "success"}`}>
              {dirty ? "待保存" : "已同步"}
            </span>
          </div>
          <ControlCenterDescList
            columns={2}
            items={[
              { label: "Kimi Code Home", value: view?.kimiCodeHome ?? "~/.kimi-code" },
              { label: "配置文件", value: view?.configPath ?? "~/.kimi-code/config.toml" },
            ]}
          />
          {view?.warnings.length ? (
            <ul className="cc-config-warning-list">
              {view.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {view?.configError ? (
            <p className="hint danger">配置文件无法解析：{view.configError}</p>
          ) : null}
        </section>

        <section className="cc-config-panel">
          <div className="cc-config-panel-head">
            <div>
              <h4>Kimi API 接入</h4>
              <p className="hint">Provider ID: {view?.provider.id ?? "kimi-app-api-key"}</p>
            </div>
            <span className={`status-pill ${view?.provider.apiKeyConfigured ? "success" : "muted"}`}>
              {view?.provider.apiKeyConfigured ? "已配置" : "未配置"}
            </span>
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
            "Search 服务",
            "search",
            "moonshot_search",
            "searchBaseUrl",
            "searchApiKeyMode",
            "searchApiKey",
          )}
          {renderService(
            "Fetch 服务",
            "fetch",
            "moonshot_fetch",
            "fetchBaseUrl",
            "fetchApiKeyMode",
            "fetchApiKey",
          )}
        </div>

        <section className="cc-config-panel">
          <div className="cc-config-panel-head">
            <div>
              <h4>子 Agent 并发上限</h4>
              <p className="hint">通过 KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY 传递。</p>
            </div>
            <span className="status-pill muted">
              {draft.clearAgentSwarmMaxConcurrency
                ? "使用官方默认"
                : draft.agentSwarmMaxConcurrency
                  ? `${draft.agentSwarmMaxConcurrency}`
                  : "未设置"}
            </span>
          </div>
          <div className="cc-config-grid two">
            <label className="field-stack">
              <span>最大并发子 Agent 数</span>
              <Input
                type="number"
                min={1}
                value={
                  draft.clearAgentSwarmMaxConcurrency
                    ? ""
                    : draft.agentSwarmMaxConcurrency?.toString() ?? ""
                }
                onChange={(event) =>
                  updateDraft({
                    agentSwarmMaxConcurrency: parsePositiveInteger(event.currentTarget.value),
                    clearAgentSwarmMaxConcurrency: !event.currentTarget.value.trim(),
                  })
                }
                placeholder={view?.runtimeLimits.agentSwarmMaxConcurrency?.toString() ?? "5"}
              />
            </label>
            <div className="cc-config-actions-column">
              <Button
                type="button"
                variant="outline"
                className="cc-action-btn"
                icon={<Trash2 size={14} />}
                onClick={() =>
                  updateDraft({
                    agentSwarmMaxConcurrency: undefined,
                    clearAgentSwarmMaxConcurrency: true,
                  })
                }
              >
                清除运行限制
              </Button>
            </div>
          </div>
        </section>

        <section className="cc-config-panel">
          <div className="cc-config-panel-head">
            <div>
              <h4>操作</h4>
            </div>
          </div>
          <div className="cc-actions wrap">
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
              打开配置目录 / 查看备份
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cc-action-btn"
              icon={<RotateCcw size={14} />}
              onClick={resetDefaultUrls}
            >
              恢复默认 URL
            </Button>
          </div>
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
