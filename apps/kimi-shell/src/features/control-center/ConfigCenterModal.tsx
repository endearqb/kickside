import { useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type {
  ConfigCenterSectionId,
  EnvOverrideStatus,
  KeyValueEntry,
  KimiCliConfigCenterInput,
  KimiCliConfigCenterView,
  McpServerEntry,
  ModelEntry,
  ProviderEntry,
  ServiceEntry,
  TypedFieldEntry,
  TypedFieldType,
} from "@/app/types";
import { PROVIDER_TYPE_OPTIONS } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ConfigCenterTaskContentProps = {
  dirty: boolean;
  view: KimiCliConfigCenterView | null;
  draft: KimiCliConfigCenterInput;
  onDraftChange: (next: KimiCliConfigCenterInput) => void;
  onOpenConfigDir: () => Promise<void>;
};

type SensitiveMap = Record<string, boolean>;

const CONFIG_SECTIONS: Array<{
  id: ConfigCenterSectionId;
  label: string;
  description: string;
}> = [
  { id: "overview", label: "概览", description: "配置路径与来源" },
  { id: "providers", label: "提供方", description: "凭据与来源策略" },
  { id: "models", label: "模型", description: "模型声明与能力" },
  { id: "services", label: "服务", description: "服务入口与路由" },
  { id: "defaults", label: "默认策略", description: "默认 provider、model 与编辑器" },
  { id: "loop_control", label: "循环控制", description: "步数、重试与超时" },
  { id: "mcp_servers", label: "MCP 服务", description: "MCP 服务列表" },
  { id: "env_overrides", label: "环境变量覆盖", description: "运行时优先级" },
];

function cloneDraft(input: KimiCliConfigCenterInput): KimiCliConfigCenterInput {
  return JSON.parse(JSON.stringify(input)) as KimiCliConfigCenterInput;
}

function createProviderEntry(): ProviderEntry {
  return {
    key: "",
    providerType: "moonshot",
    apiKey: "",
    baseUrl: "",
    authToken: "",
    appId: "",
    accessKeyId: "",
    secretAccessKey: "",
    region: "",
    apiVersion: "",
    deployment: "",
    modelName: "",
    env: [],
    customHeaders: [],
    extraFields: [],
  };
}

function createModelEntry(): ModelEntry {
  return {
    key: "",
    provider: "",
    model: "",
    maxContextSize: undefined,
    capabilities: [],
    extraFields: [],
  };
}

function createServiceEntry(): ServiceEntry {
  return {
    key: "",
    provider: "",
    model: "",
    endpoint: "",
    apiKey: "",
    timeoutMs: undefined,
    maxRetries: undefined,
    extraFields: [],
  };
}

function createMcpServerEntry(): McpServerEntry {
  return {
    key: "",
    command: "",
    args: [],
    env: [],
    enabled: undefined,
    workingDirectory: "",
    timeoutMs: undefined,
    extraFields: [],
  };
}

function createKeyValueEntry(): KeyValueEntry {
  return { key: "", value: "" };
}

function createTypedFieldEntry(): TypedFieldEntry {
  return { key: "", valueType: "string", value: "" };
}

function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.trunc(parsed);
}

function joinStringList(value: string[]): string {
  return value.join("\n");
}

function splitStringList(raw: string): string[] {
  return raw
    .split(/\r?\n|,/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseBooleanText(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return null;
}

function isKnownProviderType(value?: string): boolean {
  if (!value) return false;
  return PROVIDER_TYPE_OPTIONS.includes(value as (typeof PROVIDER_TYPE_OPTIONS)[number]);
}

function validateKeyValueEntries(
  entries: KeyValueEntry[],
  label: string,
  errors: string[],
) {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key) {
      errors.push(`${label} 存在空 key`);
      continue;
    }
    if (seen.has(key)) {
      errors.push(`${label} 存在重复 key: ${key}`);
      continue;
    }
    seen.add(key);
  }
}

function validateTypedEntries(
  entries: TypedFieldEntry[],
  label: string,
  errors: string[],
) {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key) {
      errors.push(`${label} 存在空 key`);
      continue;
    }
    if (seen.has(key)) {
      errors.push(`${label} 存在重复 key: ${key}`);
      continue;
    }
    seen.add(key);

    if (entry.valueType === "integer" && entry.value.trim()) {
      if (!Number.isInteger(Number(entry.value.trim()))) {
        errors.push(`${label}.${key} 需要合法整数`);
      }
    }
    if (entry.valueType === "float" && entry.value.trim()) {
      if (!Number.isFinite(Number(entry.value.trim()))) {
        errors.push(`${label}.${key} 需要合法浮点数`);
      }
    }
    if (entry.valueType === "boolean" && entry.value.trim()) {
      if (parseBooleanText(entry.value) === null) {
        errors.push(`${label}.${key} 需要 true/false`);
      }
    }
  }
}

export function buildBlockingErrors(draft: KimiCliConfigCenterInput): string[] {
  const errors: string[] = [];

  const providerKeys = new Set<string>();
  for (const provider of draft.providers) {
    const key = provider.key.trim();
    if (!key) {
      errors.push("providers 存在空 key");
      continue;
    }
    if (providerKeys.has(key)) {
      errors.push(`providers 存在重复 key: ${key}`);
      continue;
    }
    providerKeys.add(key);
    validateKeyValueEntries(provider.env, `providers.${key}.env`, errors);
    validateKeyValueEntries(
      provider.customHeaders,
      `providers.${key}.custom_headers`,
      errors,
    );
    validateTypedEntries(provider.extraFields, `providers.${key}.extra_fields`, errors);
  }

  const modelKeys = new Set<string>();
  for (const model of draft.models) {
    const key = model.key.trim();
    if (!key) {
      errors.push("models 存在空 key");
      continue;
    }
    if (modelKeys.has(key)) {
      errors.push(`models 存在重复 key: ${key}`);
      continue;
    }
    modelKeys.add(key);
    const provider = model.provider?.trim();
    if (provider && !providerKeys.has(provider)) {
      errors.push(`models.${key} 引用了不存在的 provider: ${provider}`);
    }
    validateTypedEntries(model.extraFields, `models.${key}.extra_fields`, errors);
  }

  const serviceKeys = new Set<string>();
  for (const service of draft.services) {
    const key = service.key.trim();
    if (!key) {
      errors.push("services 存在空 key");
      continue;
    }
    if (serviceKeys.has(key)) {
      errors.push(`services 存在重复 key: ${key}`);
      continue;
    }
    serviceKeys.add(key);
    const provider = service.provider?.trim();
    if (provider && !providerKeys.has(provider)) {
      errors.push(`services.${key} 引用了不存在的 provider: ${provider}`);
    }
    validateTypedEntries(service.extraFields, `services.${key}.extra_fields`, errors);
  }

  validateTypedEntries(draft.loopControl.extraFields, "loop_control.extra_fields", errors);

  const mcpKeys = new Set<string>();
  for (const server of draft.mcpServers) {
    const key = server.key.trim();
    if (!key) {
      errors.push("mcp_servers 存在空 key");
      continue;
    }
    if (mcpKeys.has(key)) {
      errors.push(`mcp_servers 存在重复 key: ${key}`);
      continue;
    }
    mcpKeys.add(key);
    validateKeyValueEntries(server.env, `mcp_servers.${key}.env`, errors);
    validateTypedEntries(server.extraFields, `mcp_servers.${key}.extra_fields`, errors);
  }

  return errors;
}

export function buildWarnings(
  draft: KimiCliConfigCenterInput,
  envOverrides: EnvOverrideStatus[],
  backendWarnings: string[],
): string[] {
  const warnings = [...backendWarnings];

  if (draft.defaultModel?.trim()) {
    const exists = draft.models.some(
      (entry) => entry.key.trim() === draft.defaultModel?.trim(),
    );
    if (!exists) {
      warnings.push("default_model 未在 models 表中声明（允许保存，运行时可能由环境变量覆盖）。");
    }
  }

  const overrideCount = envOverrides.filter((entry) => entry.isSet).length;
  if (overrideCount > 0) {
    warnings.push(`检测到 ${overrideCount} 个环境变量已设置，运行时将覆盖部分配置值。`);
  }

  return Array.from(new Set(warnings));
}

function KeyValueEditor({
  title,
  entries,
  onChange,
}: {
  title: string;
  entries: KeyValueEntry[];
  onChange: (next: KeyValueEntry[]) => void;
}) {
  return (
    <div className="cc-config-subsection">
      <header>
        <h5>{title}</h5>
      </header>
      <div className="cc-config-list">
        {entries.map((entry, index) => (
          <div key={`${title}-${index}`} className="cc-kv-row">
            <Input
              value={entry.key}
              onChange={(event) => {
                const next = [...entries];
                next[index] = { ...next[index], key: event.currentTarget.value };
                onChange(next);
              }}
              placeholder="键名 key"
            />
            <Input
              value={entry.value}
              onChange={(event) => {
                const next = [...entries];
                next[index] = { ...next[index], value: event.currentTarget.value };
                onChange(next);
              }}
              placeholder="值 value"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              icon={<Trash2 size={14} />}
              onClick={() => {
                const next = [...entries];
                next.splice(index, 1);
                onChange(next);
              }}
              aria-label={`删除 ${title} 项`}
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        icon={<Plus size={14} />}
        className="cc-action-btn"
        onClick={() => onChange([...entries, createKeyValueEntry()])}
      >
        添加条目
      </Button>
    </div>
  );
}

function TypedFieldEditor({
  title,
  fields,
  onChange,
}: {
  title: string;
  fields: TypedFieldEntry[];
  onChange: (next: TypedFieldEntry[]) => void;
}) {
  return (
    <div className="cc-config-subsection">
      <header>
        <h5>{title}</h5>
      </header>
      <div className="cc-config-list">
        {fields.map((field, index) => (
          <div key={`${title}-${index}`} className="cc-typed-row">
            <Input
              value={field.key}
              onChange={(event) => {
                const next = [...fields];
                next[index] = { ...next[index], key: event.currentTarget.value };
                onChange(next);
              }}
              placeholder="字段名 key"
            />
            <select
              className="ui-input cc-config-select"
              value={field.valueType}
              onChange={(event) => {
                const next = [...fields];
                next[index] = {
                  ...next[index],
                  valueType: event.currentTarget.value as TypedFieldType,
                };
                onChange(next);
              }}
            >
              <option value="string">string</option>
              <option value="integer">integer</option>
              <option value="float">float</option>
              <option value="boolean">boolean</option>
              <option value="string_array">string_array</option>
            </select>
            {field.valueType === "string_array" ? (
              <textarea
                className="ui-input cc-config-textarea"
                value={field.value}
                onChange={(event) => {
                  const next = [...fields];
                  next[index] = { ...next[index], value: event.currentTarget.value };
                  onChange(next);
                }}
                placeholder="每行一个字符串"
              />
            ) : (
              <Input
                value={field.value}
                onChange={(event) => {
                  const next = [...fields];
                  next[index] = { ...next[index], value: event.currentTarget.value };
                  onChange(next);
                }}
                placeholder="值 value"
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              icon={<Trash2 size={14} />}
              onClick={() => {
                const next = [...fields];
                next.splice(index, 1);
                onChange(next);
              }}
              aria-label={`删除 ${title} 条目`}
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        icon={<Plus size={14} />}
        className="cc-action-btn"
        onClick={() => onChange([...fields, createTypedFieldEntry()])}
      >
        添加字段
      </Button>
    </div>
  );
}

export function ConfigCenterTaskContent({
  dirty,
  view,
  draft,
  onDraftChange,
  onOpenConfigDir,
}: ConfigCenterTaskContentProps) {
  const [activeSection, setActiveSection] = useState<ConfigCenterSectionId>("overview");
  const [sensitiveVisible, setSensitiveVisible] = useState<SensitiveMap>({});

  const blockingErrors = useMemo(() => buildBlockingErrors(draft), [draft]);
  const warnings = useMemo(
    () => buildWarnings(draft, view?.envOverrides ?? [], view?.warnings ?? []),
    [draft, view?.envOverrides, view?.warnings],
  );
  const envOverrideCount = (view?.envOverrides ?? []).filter((entry) => entry.isSet).length;
  const activeSectionMeta =
    CONFIG_SECTIONS.find((section) => section.id === activeSection) ?? CONFIG_SECTIONS[0];

  function updateDraft(mutator: (next: KimiCliConfigCenterInput) => void) {
    const next = cloneDraft(draft);
    mutator(next);
    onDraftChange(next);
  }

  function toggleSensitive(key: string) {
    setSensitiveVisible((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <>
      <div className="cc-config-meta">
        <p>
          配置文件：
          <strong>{view?.configPath ?? "~/.kimi/config.toml"}</strong>
        </p>
        <p>
          配置目录：
          <strong>{view?.configDir ?? "~/.kimi"}</strong>
        </p>
        <p>
          数据目录：
          <strong>{view?.dataDir ?? "~/.kimi"}</strong>
          {view?.dataDirEnvSource ? (
            <span className="cc-meta-tag">来自 {view.dataDirEnvSource}</span>
          ) : null}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="cc-action-btn"
          onClick={() => void onOpenConfigDir()}
        >
          打开配置目录
        </Button>
      </div>

      <div className="cc-config-modal-body">
        <aside className="cc-config-nav">
          {CONFIG_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`cc-config-nav-btn ${activeSection === section.id ? "active" : ""}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span>{section.label}</span>
              <small>{section.description}</small>
            </button>
          ))}
        </aside>

        <div className="cc-config-content">
            <section className="cc-config-panel cc-config-summary-panel">
              <div className="cc-config-panel-head">
                <div>
                  <h4>{activeSectionMeta.label}</h4>
                  <p className="hint">{activeSectionMeta.description}</p>
                </div>
              </div>
              <div className="cc-config-summary-grid">
                <article className="cc-config-summary-card">
                  <span>当前区块</span>
                  <strong>{activeSectionMeta.label}</strong>
                  <small>{activeSection}</small>
                </article>
                <article className="cc-config-summary-card">
                  <span>校验错误</span>
                  <strong>{blockingErrors.length}</strong>
                  <small>{blockingErrors.length > 0 ? "保存前需处理" : "当前可保存"}</small>
                </article>
                <article className="cc-config-summary-card">
                  <span>环境变量覆盖</span>
                  <strong>{envOverrideCount}</strong>
                  <small>{envOverrideCount > 0 ? "运行时会覆盖部分值" : "当前未检测到覆盖"}</small>
                </article>
                <article className="cc-config-summary-card">
                  <span>草稿状态</span>
                  <strong>{dirty ? "未保存" : "已同步"}</strong>
                  <small>{warnings.length > 0 ? `${warnings.length} 条提醒` : "当前没有额外提醒"}</small>
                </article>
              </div>
            </section>

            {activeSection === "overview" && (
              <section className="cc-config-panel">
                <h4>概览与来源</h4>
                <p className="hint">
                  环境变量优先于配置文件。下方告警不会阻止保存，但会影响运行时生效结果。
                </p>
                {warnings.length > 0 ? (
                  <ul className="cc-config-warning-list">
                    {warnings.map((warning) => (
                      <li key={warning}>
                        <AlertTriangle size={14} />
                        <span>{warning}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">未检测到额外警告。</p>
                )}
              </section>
            )}

            {activeSection === "providers" && (
              <section className="cc-config-panel">
                <div className="cc-config-panel-head">
                  <h4>提供方</h4>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<Plus size={14} />}
                    className="cc-action-btn"
                    onClick={() =>
                      updateDraft((next) => {
                        next.providers.push(createProviderEntry());
                      })
                    }
                  >
                    新增提供方
                  </Button>
                </div>
                <div className="cc-config-card-list">
                  {draft.providers.map((provider, index) => {
                    const isCustomType =
                      provider.providerType !== undefined &&
                      provider.providerType.trim().length > 0 &&
                      !isKnownProviderType(provider.providerType);
                    const typeSelectValue = isCustomType
                      ? "custom"
                      : (provider.providerType ?? "");

                    return (
                      <article key={`provider-${index}`} className="cc-config-card">
                        <header className="cc-config-card-head">
                          <h5>提供方 #{index + 1}</h5>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            icon={<Trash2 size={14} />}
                            onClick={() =>
                              updateDraft((next) => {
                                next.providers.splice(index, 1);
                              })
                            }
                            aria-label="删除提供方"
                          />
                        </header>

                        <div className="cc-config-grid two">
                          <div className="cc-api-field">
                            <label>键名 key</label>
                            <Input
                              value={provider.key}
                              onChange={(event) =>
                                updateDraft((next) => {
                                  next.providers[index].key = event.currentTarget.value;
                                })
                              }
                              placeholder="moonshot"
                            />
                          </div>
                          <div className="cc-api-field">
                            <label>类型</label>
                            <select
                              className="ui-input cc-config-select"
                              value={typeSelectValue}
                              onChange={(event) => {
                                const nextType = event.currentTarget.value;
                                updateDraft((next) => {
                                  if (!nextType) {
                                    next.providers[index].providerType = undefined;
                                  } else if (nextType === "custom") {
                                    next.providers[index].providerType =
                                      next.providers[index].providerType ?? "";
                                  } else {
                                    next.providers[index].providerType = nextType;
                                  }
                                });
                              }}
                            >
                              <option value="">未指定</option>
                              {PROVIDER_TYPE_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                          {typeSelectValue === "custom" ? (
                            <div className="cc-api-field">
                              <label>自定义类型</label>
                              <Input
                                value={provider.providerType ?? ""}
                                onChange={(event) =>
                                  updateDraft((next) => {
                                    next.providers[index].providerType =
                                      event.currentTarget.value;
                                  })
                                }
                                placeholder="自定义 provider 类型"
                              />
                            </div>
                          ) : null}
                          {[
                            ["基础地址", "baseUrl"] as const,
                            ["区域", "region"] as const,
                            ["API 版本", "apiVersion"] as const,
                            ["部署名", "deployment"] as const,
                            ["模型名", "modelName"] as const,
                            ["应用 ID", "appId"] as const,
                            ["访问密钥 ID", "accessKeyId"] as const,
                            ["认证令牌", "authToken"] as const,
                          ].map(([label, field]) => (
                            <div key={field} className="cc-api-field">
                              <label>{label}</label>
                              <Input
                                value={(provider[field] ?? "") as string}
                                onChange={(event) =>
                                  updateDraft((next) => {
                                    next.providers[index][field] = event.currentTarget.value;
                                  })
                                }
                              />
                            </div>
                          ))}
                          {(["apiKey", "secretAccessKey"] as const).map((field) => {
                            const secretKey = `provider-${index}-${field}`;
                            const visible = sensitiveVisible[secretKey] ?? false;
                            return (
                              <div key={field} className="cc-api-field">
                                <label>{field === "apiKey" ? "API 密钥" : "访问密钥 Secret Access Key"}</label>
                                <div className="cc-secret-row">
                                  <Input
                                    type={visible ? "text" : "password"}
                                    value={(provider[field] ?? "") as string}
                                    onChange={(event) =>
                                      updateDraft((next) => {
                                        next.providers[index][field] = event.currentTarget.value;
                                      })
                                    }
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    icon={visible ? <EyeOff size={14} /> : <Eye size={14} />}
                                    onClick={() => toggleSensitive(secretKey)}
                                    aria-label={visible ? "隐藏敏感值" : "显示敏感值"}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <KeyValueEditor
                          title="环境变量 env"
                          entries={provider.env}
                          onChange={(nextEntries) =>
                            updateDraft((next) => {
                              next.providers[index].env = nextEntries;
                            })
                          }
                        />
                        <KeyValueEditor
                          title="自定义请求头 custom_headers"
                          entries={provider.customHeaders}
                          onChange={(nextEntries) =>
                            updateDraft((next) => {
                              next.providers[index].customHeaders = nextEntries;
                            })
                          }
                        />
                        <TypedFieldEditor
                          title="附加字段 extra_fields"
                          fields={provider.extraFields}
                          onChange={(nextFields) =>
                            updateDraft((next) => {
                              next.providers[index].extraFields = nextFields;
                            })
                          }
                        />
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {activeSection === "models" && (
              <section className="cc-config-panel">
                <div className="cc-config-panel-head">
                  <h4>模型</h4>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<Plus size={14} />}
                    className="cc-action-btn"
                    onClick={() =>
                      updateDraft((next) => {
                        next.models.push(createModelEntry());
                      })
                    }
                  >
                    新增模型
                  </Button>
                </div>
                <div className="cc-config-card-list">
                  {draft.models.map((model, index) => (
                    <article key={`model-${index}`} className="cc-config-card">
                      <header className="cc-config-card-head">
                        <h5>模型 #{index + 1}</h5>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          icon={<Trash2 size={14} />}
                          onClick={() =>
                            updateDraft((next) => {
                              next.models.splice(index, 1);
                            })
                          }
                          aria-label="删除模型"
                        />
                      </header>
                      <div className="cc-config-grid two">
                        <div className="cc-api-field">
                          <label>键名 key</label>
                          <Input
                            value={model.key}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.models[index].key = event.currentTarget.value;
                              })
                            }
                            placeholder="kimi-k2"
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>提供方 provider</label>
                          <Input
                            value={model.provider ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.models[index].provider = event.currentTarget.value;
                              })
                            }
                            placeholder="moonshot"
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>模型名称</label>
                          <Input
                            value={model.model ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.models[index].model = event.currentTarget.value;
                              })
                            }
                            placeholder="kimi-k2-turbo-preview"
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>最大上下文 max_context_size</label>
                          <Input
                            value={model.maxContextSize ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.models[index].maxContextSize = parseOptionalNumber(
                                  event.currentTarget.value,
                                );
                              })
                            }
                            placeholder="128000"
                          />
                        </div>
                        <div className="cc-api-field cc-span-all">
                          <label>能力列表 capabilities（逗号或换行分隔）</label>
                          <textarea
                            className="ui-input cc-config-textarea"
                            value={joinStringList(model.capabilities)}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.models[index].capabilities = splitStringList(
                                  event.currentTarget.value,
                                );
                              })
                            }
                            placeholder="chat\nvision\ntool_calling"
                          />
                        </div>
                      </div>
                      <TypedFieldEditor
                        title="附加字段 extra_fields"
                        fields={model.extraFields}
                        onChange={(nextFields) =>
                          updateDraft((next) => {
                            next.models[index].extraFields = nextFields;
                          })
                        }
                      />
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeSection === "services" && (
              <section className="cc-config-panel">
                <div className="cc-config-panel-head">
                  <h4>服务</h4>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<Plus size={14} />}
                    className="cc-action-btn"
                    onClick={() =>
                      updateDraft((next) => {
                        next.services.push(createServiceEntry());
                      })
                    }
                  >
                    新增服务
                  </Button>
                </div>
                <div className="cc-config-card-list">
                  {draft.services.map((service, index) => (
                    <article key={`service-${index}`} className="cc-config-card">
                      <header className="cc-config-card-head">
                        <h5>服务 #{index + 1}</h5>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          icon={<Trash2 size={14} />}
                          onClick={() =>
                            updateDraft((next) => {
                              next.services.splice(index, 1);
                            })
                          }
                          aria-label="删除服务"
                        />
                      </header>
                      <div className="cc-config-grid two">
                        <div className="cc-api-field">
                          <label>键名 key</label>
                          <Input
                            value={service.key}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.services[index].key = event.currentTarget.value;
                              })
                            }
                            placeholder="default"
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>提供方 provider</label>
                          <Input
                            value={service.provider ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.services[index].provider = event.currentTarget.value;
                              })
                            }
                            placeholder="moonshot"
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>模型 model</label>
                          <Input
                            value={service.model ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.services[index].model = event.currentTarget.value;
                              })
                            }
                            placeholder="kimi-k2"
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>接口地址</label>
                          <Input
                            value={service.endpoint ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.services[index].endpoint = event.currentTarget.value;
                              })
                            }
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>API 密钥</label>
                          <Input
                            type="password"
                            value={service.apiKey ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.services[index].apiKey = event.currentTarget.value;
                              })
                            }
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>超时 timeout_ms</label>
                          <Input
                            value={service.timeoutMs ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.services[index].timeoutMs = parseOptionalNumber(
                                  event.currentTarget.value,
                                );
                              })
                            }
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>重试上限 max_retries</label>
                          <Input
                            value={service.maxRetries ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.services[index].maxRetries = parseOptionalNumber(
                                  event.currentTarget.value,
                                );
                              })
                            }
                          />
                        </div>
                      </div>
                      <TypedFieldEditor
                        title="附加字段 extra_fields"
                        fields={service.extraFields}
                        onChange={(nextFields) =>
                          updateDraft((next) => {
                            next.services[index].extraFields = nextFields;
                          })
                        }
                      />
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeSection === "defaults" && (
              <section className="cc-config-panel">
                <h4>默认策略</h4>
                <div className="cc-config-grid two">
                  <div className="cc-api-field">
                    <label>默认提供方 provider</label>
                    <Input
                      value={draft.defaultProvider ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.defaultProvider = event.currentTarget.value;
                        })
                      }
                    />
                  </div>
                  <div className="cc-api-field">
                    <label>默认模型 model</label>
                    <Input
                      value={draft.model ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.model = event.currentTarget.value;
                        })
                      }
                    />
                  </div>
                  <div className="cc-api-field">
                    <label>默认模型键 default_model</label>
                    <Input
                      value={draft.defaultModel ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.defaultModel = event.currentTarget.value;
                        })
                      }
                    />
                  </div>
                  <div className="cc-api-field">
                    <label>默认服务 default_service</label>
                    <Input
                      value={draft.defaultService ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.defaultService = event.currentTarget.value;
                        })
                      }
                    />
                  </div>
                  <div className="cc-api-field">
                    <label>默认编辑器 default_editor</label>
                    <Input
                      value={draft.defaultEditor ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.defaultEditor = event.currentTarget.value;
                        })
                      }
                    />
                  </div>
                  <div className="cc-api-field">
                    <label>默认 yolo 模式 default_yolo_mode</label>
                    <Input
                      value={draft.defaultYoloMode ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.defaultYoloMode = event.currentTarget.value;
                        })
                      }
                    />
                  </div>
                  <div className="cc-api-field">
                    <label>默认 thinking 模式 default_thinking_mode</label>
                    <Input
                      value={draft.defaultThinkingMode ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.defaultThinkingMode = event.currentTarget.value;
                        })
                      }
                    />
                  </div>
                  <div className="cc-api-field">
                    <label>默认 yolo 开关 default_yolo</label>
                    <select
                      className="ui-input cc-config-select"
                      value={
                        typeof draft.defaultYolo === "boolean"
                          ? String(draft.defaultYolo)
                          : ""
                      }
                      onChange={(event) =>
                        updateDraft((next) => {
                          const value = parseBooleanText(event.currentTarget.value);
                          next.defaultYolo = value === null ? undefined : value;
                        })
                      }
                    >
                      <option value="">未指定</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </div>
                  <div className="cc-api-field">
                    <label>默认 thinking 开关 default_thinking</label>
                    <select
                      className="ui-input cc-config-select"
                      value={
                        typeof draft.defaultThinking === "boolean"
                          ? String(draft.defaultThinking)
                          : ""
                      }
                      onChange={(event) =>
                        updateDraft((next) => {
                          const value = parseBooleanText(event.currentTarget.value);
                          next.defaultThinking = value === null ? undefined : value;
                        })
                      }
                    >
                      <option value="">未指定</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </div>
                  <div className="cc-api-field">
                    <label>关闭本地模型自动拉取 local_model_disable_auto_pull</label>
                    <select
                      className="ui-input cc-config-select"
                      value={
                        typeof draft.localModelDisableAutoPull === "boolean"
                          ? String(draft.localModelDisableAutoPull)
                          : ""
                      }
                      onChange={(event) =>
                        updateDraft((next) => {
                          const value = parseBooleanText(event.currentTarget.value);
                          next.localModelDisableAutoPull =
                            value === null ? undefined : value;
                        })
                      }
                    >
                      <option value="">未指定</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </div>
                </div>
              </section>
            )}
            {activeSection === "loop_control" && (
              <section className="cc-config-panel">
                <h4>循环控制</h4>
                <div className="cc-config-grid two">
                  <div className="cc-api-field">
                    <label>启用 enabled</label>
                    <select
                      className="ui-input cc-config-select"
                      value={
                        typeof draft.loopControl.enabled === "boolean"
                          ? String(draft.loopControl.enabled)
                          : ""
                      }
                      onChange={(event) =>
                        updateDraft((next) => {
                          const value = parseBooleanText(event.currentTarget.value);
                          next.loopControl.enabled = value === null ? undefined : value;
                        })
                      }
                    >
                      <option value="">未指定</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </div>
                  <div className="cc-api-field">
                    <label>最大步骤 max_steps</label>
                    <Input
                      value={draft.loopControl.maxSteps ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.loopControl.maxSteps = parseOptionalNumber(
                            event.currentTarget.value,
                          );
                        })
                      }
                    />
                  </div>
                  <div className="cc-api-field">
                    <label>最大重试 max_retries</label>
                    <Input
                      value={draft.loopControl.maxRetries ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.loopControl.maxRetries = parseOptionalNumber(
                            event.currentTarget.value,
                          );
                        })
                      }
                    />
                  </div>
                  <div className="cc-api-field">
                    <label>超时 timeout_ms</label>
                    <Input
                      value={draft.loopControl.timeoutMs ?? ""}
                      onChange={(event) =>
                        updateDraft((next) => {
                          next.loopControl.timeoutMs = parseOptionalNumber(
                            event.currentTarget.value,
                          );
                        })
                      }
                    />
                  </div>
                </div>
                <TypedFieldEditor
                  title="附加字段 extra_fields"
                  fields={draft.loopControl.extraFields}
                  onChange={(nextFields) =>
                    updateDraft((next) => {
                      next.loopControl.extraFields = nextFields;
                    })
                  }
                />
              </section>
            )}

            {activeSection === "mcp_servers" && (
              <section className="cc-config-panel">
                <div className="cc-config-panel-head">
                  <h4>MCP 服务</h4>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<Plus size={14} />}
                    className="cc-action-btn"
                    onClick={() =>
                      updateDraft((next) => {
                        next.mcpServers.push(createMcpServerEntry());
                      })
                    }
                  >
                    新增 MCP 服务
                  </Button>
                </div>
                <div className="cc-config-card-list">
                  {draft.mcpServers.map((server, index) => (
                    <article key={`mcp-${index}`} className="cc-config-card">
                      <header className="cc-config-card-head">
                        <h5>MCP 服务 #{index + 1}</h5>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          icon={<Trash2 size={14} />}
                          onClick={() =>
                            updateDraft((next) => {
                              next.mcpServers.splice(index, 1);
                            })
                          }
                          aria-label="删除 MCP 服务"
                        />
                      </header>
                      <div className="cc-config-grid two">
                        <div className="cc-api-field">
                          <label>键名 key</label>
                          <Input
                            value={server.key}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.mcpServers[index].key = event.currentTarget.value;
                              })
                            }
                            placeholder="filesystem"
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>启动命令 command</label>
                          <Input
                            value={server.command ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.mcpServers[index].command = event.currentTarget.value;
                              })
                            }
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>工作目录 working_directory</label>
                          <Input
                            value={server.workingDirectory ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.mcpServers[index].workingDirectory =
                                  event.currentTarget.value;
                              })
                            }
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>超时 timeout_ms</label>
                          <Input
                            value={server.timeoutMs ?? ""}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.mcpServers[index].timeoutMs = parseOptionalNumber(
                                  event.currentTarget.value,
                                );
                              })
                            }
                          />
                        </div>
                        <div className="cc-api-field">
                          <label>启用 enabled</label>
                          <select
                            className="ui-input cc-config-select"
                            value={
                              typeof server.enabled === "boolean"
                                ? String(server.enabled)
                                : ""
                            }
                            onChange={(event) =>
                              updateDraft((next) => {
                                const value = parseBooleanText(event.currentTarget.value);
                                next.mcpServers[index].enabled =
                                  value === null ? undefined : value;
                              })
                            }
                          >
                            <option value="">未指定</option>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        </div>
                        <div className="cc-api-field cc-span-all">
                          <label>参数 args（逗号或换行分隔）</label>
                          <textarea
                            className="ui-input cc-config-textarea"
                            value={joinStringList(server.args)}
                            onChange={(event) =>
                              updateDraft((next) => {
                                next.mcpServers[index].args = splitStringList(
                                  event.currentTarget.value,
                                );
                              })
                            }
                            placeholder="--stdio"
                          />
                        </div>
                      </div>
                      <KeyValueEditor
                        title="环境变量 env"
                        entries={server.env}
                        onChange={(nextEntries) =>
                          updateDraft((next) => {
                            next.mcpServers[index].env = nextEntries;
                          })
                        }
                      />
                      <TypedFieldEditor
                        title="附加字段 extra_fields"
                        fields={server.extraFields}
                        onChange={(nextFields) =>
                          updateDraft((next) => {
                            next.mcpServers[index].extraFields = nextFields;
                          })
                        }
                      />
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeSection === "env_overrides" && (
              <section className="cc-config-panel">
                <h4>环境变量覆盖状态（只读）</h4>
                <p className="hint">
                  环境变量优先级高于 `config.toml`，仅展示状态，不会在本弹窗中写系统环境变量。
                </p>
                <div className="cc-env-list">
                  {(view?.envOverrides ?? []).map((entry) => (
                    <article key={entry.key} className="cc-env-item">
                      <header>
                        <strong>{entry.key}</strong>
                        <span className={entry.isSet ? "saved" : "unsaved"}>
                          {entry.isSet ? "已设置" : "未设置"}
                        </span>
                      </header>
                      <p>
                        当前值：<code>{entry.maskedValue ?? "-"}</code>
                      </p>
                      <p>
                        覆盖对象：<code>{entry.overrides.join(", ") || "-"}</code>
                      </p>
                      <p>{entry.priority}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
        </div>
      </div>
    </>
  );
}
