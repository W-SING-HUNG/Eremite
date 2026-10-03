export const workspaceRoutes = {
  inbox: "/inbox",
  actions: "/actions",
  automations: "/automations",
} as const;

export const workspaceRevalidationPaths = [workspaceRoutes.inbox, workspaceRoutes.actions, workspaceRoutes.automations] as const;
