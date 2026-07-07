import { type RefObject } from "react";
import type {
  Theme,
  WorkspaceLayoutMode,
  WorkspacePaneState,
  WorkspaceSplitOrder,
  WorkspaceViewKind,
} from "@/app/types";
import { WorkspaceGridView } from "@/features/workspace-grid/WorkspaceGridView";

export type WorkspaceViewProps = {
  activeWorkspaceView: WorkspaceViewKind;
  workspaceLayoutMode: WorkspaceLayoutMode;
  workspaceSplitOrder: WorkspaceSplitOrder;
  workspaceSplitRatio: number;
  isSplitDragging: boolean;
  codeRemoteUrl: string | null;
  codeFrameKey: string;
  chatRemoteUrl: string;
  effectiveWorkDir?: string;
  themeMode: Theme;
  workspaceIframeRef: RefObject<HTMLIFrameElement | null>;
  workspaceBridgeNonce: string;
  chatIframeRef: RefObject<HTMLIFrameElement | null>;
  codePaneState: WorkspacePaneState;
  chatPaneState: WorkspacePaneState;
  actionBusy: boolean;
  onRetry: () => void;
  onOpenLogs: () => void;
  onOpenFolder: (path: string) => void;
  onOpenExternalUrl: (url: string) => void;
  onSplitRatioChange: (nextRatio: number) => void;
  onSplitDragStateChange: (isDragging: boolean) => void;
  onCodeFrameLoad: () => void;
  onCodeFrameError: () => void;
  onChatFrameLoad: () => void;
  onChatFrameError: () => void;
};

export function WorkspaceView(props: WorkspaceViewProps) {
  return <WorkspaceGridView {...props} />;
}
