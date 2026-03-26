import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Shield, ShieldOff, Sparkles } from "lucide-react";
import type {
  InstalledSkill,
  SessionSkillState,
  SkillApplyScope,
  SkillCenterSectionId,
  SkillDetail,
  SkillProjectionRecord,
  WorkspaceSkillProfile,
} from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SkillCenterFilter = "all" | "session" | "global" | "untrusted";

type SkillCenterPanelProps = {
  surface: "page";
  busy: boolean;
  section: SkillCenterSectionId;
  installedSkills: InstalledSkill[];
  selectedSkillId: string | null;
  selectedSkillDetail: SkillDetail | null;
  globalSkillProjections: SkillProjectionRecord[];
  activeSessionSkillState: SessionSkillState;
  workspaceSkillProfile: WorkspaceSkillProfile | null;
  workspaceRecentSkillIds: string[];
  currentWorkspaceLabel?: string;
  onSelectSkill: (skillId: string) => void;
  onOpenSkillFromInsights: (skillId: string) => void;
  onSetTrust: (skillId: string, trusted: boolean) => void;
  onApplySkill: (skillId: string, scope: SkillApplyScope) => void;
  onRemoveSkill: (skillId: string, scope: SkillApplyScope) => void;
  onRecoverWorkspaceSkill: (skillId: string) => void;
  search: string;
  filter: SkillCenterFilter;
  onSearchChange: (value: string) => void;
};

function statusForSkill(
  skillId: string,
  globalSkillProjections: SkillProjectionRecord[],
  activeSessionSkillState: SessionSkillState,
) {
  return {
    globalApplied: globalSkillProjections.some((item) => item.skillId === skillId),
    sessionApplied: activeSessionSkillState.appliedSkillIds.includes(skillId),
  };
}

function projectionForSkill(skillId: string, projections: SkillProjectionRecord[]) {
  return projections.find((item) => item.skillId === skillId) ?? null;
}

function renderStatusChip(label: string, tone: "ready" | "muted" | "warning") {
  return <span className={`skill-center-chip skill-center-chip-${tone}`}>{label}</span>;
}

function formatSkillSource(skill: InstalledSkill) {
  if (skill.sourceType === "git") {
    return skill.repoUrl || skill.sourceLabel || "Git";
  }
  if (skill.sourceType === "bundled") {
    return "内置 Skill";
  }
  return skill.sourcePath || skill.sourceLabel || "本地导入";
}

export function SkillCenterPanel({
  surface,
  busy,
  section,
  installedSkills,
  selectedSkillId,
  selectedSkillDetail,
  globalSkillProjections,
  activeSessionSkillState,
  workspaceSkillProfile,
  workspaceRecentSkillIds,
  currentWorkspaceLabel,
  onSelectSkill,
  onOpenSkillFromInsights,
  onSetTrust,
  onApplySkill,
  onRemoveSkill,
  onRecoverWorkspaceSkill,
  search,
  filter,
  onSearchChange,
}: SkillCenterPanelProps) {
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);

  useEffect(() => {
    setMetaExpanded(false);
    setFilesExpanded(false);
  }, [selectedSkillId]);

  const recentSkills = useMemo(
    () =>
      workspaceRecentSkillIds
        .map((skillId) => installedSkills.find((item) => item.id === skillId))
        .filter((item): item is InstalledSkill => Boolean(item)),
    [installedSkills, workspaceRecentSkillIds],
  );

  const currentAppliedSkills = useMemo(
    () =>
      activeSessionSkillState.appliedSkillIds
        .map((skillId) => installedSkills.find((item) => item.id === skillId))
        .filter((item): item is InstalledSkill => Boolean(item)),
    [activeSessionSkillState.appliedSkillIds, installedSkills],
  );

  const lastSessionSkills = useMemo(
    () =>
      (workspaceSkillProfile?.lastSessionSkillIds ?? [])
        .map((skillId) => installedSkills.find((item) => item.id === skillId))
        .filter((item): item is InstalledSkill => Boolean(item)),
    [installedSkills, workspaceSkillProfile?.lastSessionSkillIds],
  );

  const filteredSkills = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return installedSkills.filter((skill) => {
      const matchesKeyword =
        !keyword ||
        skill.name.toLowerCase().includes(keyword) ||
        skill.description.toLowerCase().includes(keyword) ||
        skill.projectionName.toLowerCase().includes(keyword);
      if (!matchesKeyword) {
        return false;
      }
      const state = statusForSkill(skill.id, globalSkillProjections, activeSessionSkillState);
      if (filter === "session") {
        return state.sessionApplied;
      }
      if (filter === "global") {
        return state.globalApplied;
      }
      if (filter === "untrusted") {
        return !skill.trusted;
      }
      return true;
    });
  }, [
    activeSessionSkillState,
    filter,
    globalSkillProjections,
    installedSkills,
    search,
  ]);

  const selectedSkill =
    selectedSkillDetail?.skill ??
    installedSkills.find((item) => item.id === selectedSkillId) ??
    null;
  const selectedState = selectedSkill
    ? statusForSkill(selectedSkill.id, globalSkillProjections, activeSessionSkillState)
    : { globalApplied: false, sessionApplied: false };
  const selectedGlobalProjection = selectedSkill
    ? projectionForSkill(selectedSkill.id, globalSkillProjections)
    : null;
  const selectedSessionProjection = selectedSkill
    ? projectionForSkill(selectedSkill.id, activeSessionSkillState.projections)
    : null;

  const renderCollapsibleSection = (
    title: string,
    expanded: boolean,
    onToggle: () => void,
    content: ReactNode,
  ) => (
    <section className={`skill-center-collapsible ${expanded ? "is-open" : ""}`}>
      <button
        type="button"
        className="skill-center-section-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="skill-center-section-toggle-copy">
          <h4>{title}</h4>
        </div>
        <ChevronRight
          size={16}
          className={`skill-center-section-toggle-icon ${expanded ? "is-open" : ""}`}
        />
      </button>
      {expanded ? <div className="skill-center-section-body">{content}</div> : null}
    </section>
  );

  return (
    <div className={`skill-center skill-center-${surface}`}>
      <div className="skill-center-content">
        {section === "manage" ? (
          <div className="skill-center-manage">
            <div className="skill-center-sidebar">
              <div className="skill-center-toolbar">
                <Input
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="搜索已安装技能"
                />
              </div>
              <div className="skill-center-list">
                {filteredSkills.length === 0 ? (
                  <div className="skill-center-empty">
                    <Sparkles size={16} />
                    <p>还没有匹配的技能。</p>
                  </div>
                ) : null}
                {filteredSkills.map((skill) => {
                  const state = statusForSkill(
                    skill.id,
                    globalSkillProjections,
                    activeSessionSkillState,
                  );
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      className={`skill-center-list-item ${selectedSkillId === skill.id ? "active" : ""}`}
                      onClick={() => onSelectSkill(skill.id)}
                    >
                      <div className="skill-center-list-header">
                        <strong>{skill.name}</strong>
                        <div className="skill-center-chip-row skill-center-chip-row-compact">
                          {skill.trusted
                            ? renderStatusChip("已信任", "ready")
                            : renderStatusChip("未信任", "warning")}
                          {state.globalApplied ? renderStatusChip("全局", "muted") : null}
                          {state.sessionApplied
                            ? renderStatusChip("当前工作区", "muted")
                            : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="skill-center-detail">
              {selectedSkill ? (
                <>
                  <div className="skill-center-detail-header">
                    <div className="skill-center-detail-title">
                      <h3>{selectedSkill.name}</h3>
                    </div>
                    <div className="skill-center-chip-row skill-center-chip-row-detail">
                      {selectedSkill.trusted
                        ? renderStatusChip("已信任", "ready")
                        : renderStatusChip("未信任", "warning")}
                      {selectedState.globalApplied ? renderStatusChip("全局", "muted") : null}
                      {selectedState.sessionApplied
                        ? renderStatusChip("当前工作区", "muted")
                        : null}
                    </div>
                  </div>
                  <p className="skill-center-detail-description">
                    {selectedSkill.description || "这个技能没有提供描述。"}
                  </p>

                  <div className="skill-center-actions skill-center-actions-primary">
                    <Button
                      type="button"
                      onClick={() => onApplySkill(selectedSkill.id, "session_kimi")}
                      disabled={busy || selectedState.sessionApplied}
                    >
                      应用到当前工作区
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onApplySkill(selectedSkill.id, "user_global_kimi")}
                      disabled={busy || selectedState.globalApplied}
                    >
                      应用到用户全局
                    </Button>
                  </div>

                  <div className="skill-center-actions skill-center-actions-secondary">
                    <Button
                      type="button"
                      variant="outline"
                      icon={
                        selectedSkill.trusted ? <ShieldOff size={14} /> : <Shield size={14} />
                      }
                      onClick={() => onSetTrust(selectedSkill.id, !selectedSkill.trusted)}
                      disabled={busy}
                    >
                      {selectedSkill.trusted ? "取消信任" : "信任技能"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onRemoveSkill(selectedSkill.id, "user_global_kimi")}
                      disabled={busy || !selectedState.globalApplied}
                    >
                      从用户全局移除
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onRemoveSkill(selectedSkill.id, "session_kimi")}
                      disabled={busy || !selectedState.sessionApplied}
                    >
                      从当前工作区移除
                    </Button>
                  </div>

                  {renderCollapsibleSection(
                    "基础信息",
                    metaExpanded,
                    () => setMetaExpanded((current) => !current),
                    <dl className="skill-center-meta">
                      <div>
                        <dt>投影名</dt>
                        <dd>{selectedSkill.projectionName}</dd>
                      </div>
                      <div>
                        <dt>来源</dt>
                        <dd>{formatSkillSource(selectedSkill)}</dd>
                      </div>
                      {selectedSkill.sourceType === "git" ? (
                        <div>
                          <dt>Ref</dt>
                          <dd>{selectedSkill.gitRef || "默认 HEAD"}</dd>
                        </div>
                      ) : null}
                      {selectedSkill.sourceType === "git" && selectedSkill.commit ? (
                        <div>
                          <dt>Commit</dt>
                          <dd>{selectedSkill.commit}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>本地路径</dt>
                        <dd>{selectedSkill.localPath}</dd>
                      </div>
                      <div>
                        <dt>脚本</dt>
                        <dd>{selectedSkill.hasScripts ? "包含 scripts/" : "无 scripts/"}</dd>
                      </div>
                    </dl>,
                  )}

                  {renderCollapsibleSection(
                    "技能内容预览",
                    filesExpanded,
                    () => setFilesExpanded((current) => !current),
                    <div className="skill-center-files">
                      <div className="skill-center-file-list">
                        {(selectedSkillDetail?.relativePaths ?? []).slice(0, 48).map((item) => (
                          <code key={item}>{item}</code>
                        ))}
                      </div>
                    </div>,
                  )}

                  <div className="skill-center-recent">
                    <div className="skill-center-section-header">
                      <h4>当前工作区最近使用</h4>
                      <span>{currentWorkspaceLabel || "未识别工作区"}</span>
                    </div>
                    {recentSkills.length === 0 ? (
                      <p className="skill-center-muted">这个工作区还没有最近使用记录。</p>
                    ) : (
                      <div className="skill-center-recent-list">
                        {recentSkills.map((skill) => (
                          <div key={skill.id} className="skill-center-recent-item">
                            <div>
                              <strong>{skill.name}</strong>
                              <p>{skill.projectionName}</p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => onRecoverWorkspaceSkill(skill.id)}
                              disabled={busy}
                            >
                              应用到当前工作区
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="skill-center-applied-paths">
                    <div className="skill-center-section-header">
                      <h4>已应用目录</h4>
                    </div>
                    {!selectedGlobalProjection && !selectedSessionProjection ? (
                      <p className="skill-center-muted">这个技能当前还没有应用到任何目录。</p>
                    ) : (
                      <div className="skill-center-path-list">
                        {selectedGlobalProjection ? (
                          <div className="skill-center-path-item">
                            <strong>全局</strong>
                            <code>{selectedGlobalProjection.targetPath}</code>
                          </div>
                        ) : null}
                        {selectedSessionProjection ? (
                          <div className="skill-center-path-item">
                            <strong>当前工作区</strong>
                            <code>{selectedSessionProjection.targetPath}</code>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="skill-center-empty skill-center-empty-detail">
                  <Sparkles size={18} />
                  <p>选择一个已安装技能，查看详情和应用状态。</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="skill-center-insights">
            <section className="skill-center-insight-card">
              <div className="skill-center-section-header">
                <h4>当前工作区</h4>
                <span>{currentWorkspaceLabel || "未识别工作区"}</span>
              </div>
              <div className="skill-center-insight-stats">
                <div className="skill-center-insight-stat">
                  <span>当前 Session</span>
                  <strong>{activeSessionSkillState.sessionId || "未就绪"}</strong>
                </div>
                <div className="skill-center-insight-stat">
                  <span>当前工作区已应用</span>
                  <strong>{currentAppliedSkills.length}</strong>
                </div>
                <div className="skill-center-insight-stat">
                  <span>用户全局已应用</span>
                  <strong>{globalSkillProjections.length}</strong>
                </div>
                <div className="skill-center-insight-stat">
                  <span>最近使用记录</span>
                  <strong>{workspaceSkillProfile?.recentSkillIds.length ?? 0}</strong>
                </div>
              </div>
            </section>

            <section className="skill-center-insight-card">
              <div className="skill-center-section-header">
                <h4>当前工作区已应用技能</h4>
                <span>{currentAppliedSkills.length > 0 ? "可直接跳回管理查看详情" : "暂无"}</span>
              </div>
              {currentAppliedSkills.length > 0 ? (
                <div className="skill-center-recent-list">
                  {currentAppliedSkills.map((skill) => (
                    <div key={skill.id} className="skill-center-recent-item">
                      <div>
                        <strong>{skill.name}</strong>
                        <p>{skill.projectionName}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenSkillFromInsights(skill.id)}
                        disabled={busy}
                      >
                        查看技能
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="skill-center-muted">当前工作区还没有已应用技能。</p>
              )}
            </section>

            <section className="skill-center-insight-card">
              <div className="skill-center-section-header">
                <h4>最近使用</h4>
                <span>{recentSkills.length > 0 ? "恢复常用技能" : "暂无记录"}</span>
              </div>
              {recentSkills.length > 0 ? (
                <div className="skill-center-recent-list">
                  {recentSkills.map((skill) => (
                    <div key={skill.id} className="skill-center-recent-item">
                      <div>
                        <strong>{skill.name}</strong>
                        <p>{skill.projectionName}</p>
                      </div>
                      <div className="skill-center-actions-inline">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onOpenSkillFromInsights(skill.id)}
                          disabled={busy}
                        >
                          查看技能
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onRecoverWorkspaceSkill(skill.id)}
                          disabled={busy}
                        >
                          应用到当前工作区
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="skill-center-muted">这个工作区还没有最近使用记录。</p>
              )}
            </section>

            <section className="skill-center-insight-card">
              <div className="skill-center-section-header">
                <h4>上次 Session 使用</h4>
                <span>{lastSessionSkills.length > 0 ? "支持快速恢复" : "暂无记录"}</span>
              </div>
              {lastSessionSkills.length > 0 ? (
                <div className="skill-center-recent-list">
                  {lastSessionSkills.map((skill) => (
                    <div key={skill.id} className="skill-center-recent-item">
                      <div>
                        <strong>{skill.name}</strong>
                        <p>{skill.projectionName}</p>
                      </div>
                      <div className="skill-center-actions-inline">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onOpenSkillFromInsights(skill.id)}
                          disabled={busy}
                        >
                          查看技能
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onRecoverWorkspaceSkill(skill.id)}
                          disabled={busy}
                        >
                          应用到当前工作区
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="skill-center-muted">这个工作区还没有上次 Session 使用记录。</p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
