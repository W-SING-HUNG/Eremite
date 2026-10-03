/** Data-only browser contract. No configuration, provider types or credentials. */
export type AIThread = { id: string; title: string; revision: number; created_at: string; updated_at: string };
export type AISource = { module: 'inbox' | 'projects' | 'actions'; entity: 'content' | 'project' | 'action'; id: string; revision?: number; fileVersionId?: string; label: string; href: string };
export type AIContextTarget = { kind: 'global' } | { kind: 'content'; id: string } | { kind: 'project'; id: string } | { kind: 'actions'; id?: string; projectId?: string };
export type AIChatErrorCode = 'ai_generation_failed' | 'ai_cancelled' | 'ai_timeout' | 'ai_interrupted' | 'ai_tool_call_invalid' | 'ai_step_limit';
export type AIActionDraftLifecycle = 'pending' | 'confirmed' | 'rejected' | 'unavailable';
export type AIActionDraftArtifact = {
  actionId: string; revision: number; actionRevisionAtCreation: number; createdAt: string;
  title: string; priority: 'low' | 'normal' | 'high'; dueDate: string | null;
  project: { id: string; name: string } | null;
  linkedContent: Array<{ id: string; title: string; available: boolean }>;
  lifecycle: AIActionDraftLifecycle; actionStatus: 'draft' | 'active' | 'done' | 'cancelled' | 'archived' | 'unavailable';
};
export type AIActionUpdateLifecycle = 'pending' | 'applying' | 'applied' | 'rejected' | 'stale' | 'unavailable' | 'error';
export type AIActionUpdateArtifact = {
  id: string; actionId: string; actionRevision: number; createdAt: string; appliedRevision: number | null;
  before: { title: string; priority: 'low' | 'normal' | 'high'; dueDate: string | null; status: 'active' };
  patch: { title?: string; priority?: 'low' | 'normal' | 'high'; dueDate?: string | null; transition?: 'done' | 'cancelled' };
  lifecycle: AIActionUpdateLifecycle;
};
export type AIActionDisambiguationArtifact = {
  id: string; lifecycle: 'pending' | 'resolved' | 'stale'; selectedActionId: string | null;
  candidates: Array<{ actionId: string; revision: number; title: string; projectName: string | null; dueDate: string | null; priority: 'low' | 'normal' | 'high'; createdAt: string }>;
  patch: { title?: string; priority?: 'low' | 'normal' | 'high'; dueDate?: string | null; transition?: 'done' | 'cancelled' };
};
export type AIToolRunProposalArtifact = {
  id: string; toolId: 'core.file-converter' | 'core.pdf-tools'; toolName: string;
  lifecycle: 'pending' | 'rejected' | 'stale' | 'accepted';
  sources: Array<{ contentId: string; title: string; originalName: string }>;
  operationLabel: string; parametersLabel: string; destinationLabel: string;
  run: { id: string; status: 'running' | 'completed' | 'failed'; errorMessage: string | null;
    outputs: Array<{ contentId: string; originalName: string; previewable: boolean }> } | null;
};
export type AIChatMessage = {
  id: string; thread_id: string; ordinal: number; role: 'user' | 'assistant'; content: string; created_at: string;
  run_id: string | null; status: 'running' | 'completed' | 'cancelled' | 'failed' | null;
  error_code: AIChatErrorCode | null; model: string | null; sources: AISource[]; activities: AIDurableActivity[]; actionDrafts: AIActionDraftArtifact[]; actionUpdates: AIActionUpdateArtifact[]; actionDisambiguations: AIActionDisambiguationArtifact[]; toolRunProposals: AIToolRunProposalArtifact[];
};
export type AIThreadDetail = { thread: AIThread; messages: AIChatMessage[]; hasOlder: boolean };
export type AIProviderStatus = { configured: boolean; model: string | null };
export type AIActivity = {
  kind: 'search' | 'content' | 'project' | 'actions' | 'draft' | 'update' | 'tool-run';
  state: 'started' | 'succeeded' | 'failed' | 'needs_input';
  code?: 'ai_tool_invalid_arguments' | 'ai_tool_unobserved_content' | 'ai_tool_unobserved_project' | 'ai_tool_host_rejected' | 'ai_tool_ambiguous_target' | 'ai_tool_execution_failed' | 'ai_tool_run_unobserved_source' | 'ai_tool_run_source_unavailable' | 'ai_tool_run_unsupported_capability' | 'ai_tool_run_invalid_parameters' | 'ai_tool_run_unavailable';
};
export type AIDurableActivity = Omit<AIActivity, 'state'> & { state: 'succeeded' | 'failed' | 'needs_input' };

export function aiChatErrorMessage(code: string) {
  switch (code) {
    case 'ai_cancelled': return '已停止生成，已接收的内容已保留。';
    case 'ai_timeout': return '生成超时，请稍后重试。';
    case 'ai_interrupted': return '上次生成被中断，可以继续提问。';
    case 'ai_unavailable': return 'AI Provider 尚未配置或需要重新输入 API Key。请前往设置 → AI。';
    case 'ai_revision_conflict': return '会话已在其他页面更新，请重新打开会话后再发送。';
    case 'ai_run_active': return '此会话正在生成，请停止或等待完成。';
    case 'ai_duplicate_request': return '这条消息已经提交，请重新打开会话查看结果。';
    case 'ai_context_unavailable': return '当前资料或专案不可用，请切换页面后重试。';
    case 'ai_step_limit': return '已达到本次读取上限，可以继续提问。';
    case 'ai_tool_call_invalid': return '工具调用未能完成；请检查实际结果后重试。';
    case 'ai_action_draft_not_found': return '这个行动草稿不属于当前会话，无法操作。';
    case 'ai_action_draft_not_pending': return '这个行动草稿已不是待确认状态，请刷新后查看。';
    case 'action_revision_conflict': return '行动草稿已发生变化，请刷新后再试。';
    case 'ai_action_update_not_found': return '这个修改提案不属于当前会话，无法操作。';
    case 'ai_action_update_not_allowed': return '只能针对当前已读取且可修改的任务提出变更。';
    case 'ai_action_update_not_pending': return '这个修改提案已处理，请刷新查看。';
    case 'ai_action_update_stale': return '任务已经发生变化，请刷新后重新确认。';
    case 'ai_tool_run_stale': return '来源或工具状态已变化，请重新提出操作。';
    case 'ai_tool_run_stale_source': return '来源已经变化，请重新提出操作。';
    case 'ai_tool_run_stale_tool': return '工具或输出位置已经变化，请重新提出操作。';
    case 'ai_tool_run_internal_failure': return '操作未能完成，请稍后重试。';
    case 'ai_tool_run_unobserved_source': return '请先读取当前文件后再提出操作。';
    case 'ai_tool_run_source_unavailable': return '当前来源文件不可用。';
    case 'ai_tool_run_unsupported_capability': return '当前文件不支持这个操作。';
    case 'ai_tool_run_invalid_parameters': return '操作参数无效。';
    case 'ai_tool_run_unavailable': return '文件工具当前不可用。';
    case 'ai_tool_run_limit': return '本轮已准备一个文件操作提案，请开启新对话或继续下一轮。';
    case 'ai_tool_run_not_pending': return '这个操作提案已处理，请刷新查看。';
    case 'ai_tool_run_not_found': return '这个操作提案不属于当前会话或消息。';
    case 'ai_tool_run_not_allowed': return '只能对本轮已读取且受支持的文件提出操作。';
    case 'ai_action_update_ambiguous': return '找到多个可能的行动，请明确选择目标或提供专案、截止日期。';
    default: return '请求未能完成，请稍后重试。';
  }
}
