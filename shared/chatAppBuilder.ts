const projectPattern = /^session-[a-z0-9-]{1,70}$/i;

export function isChatAppProject(value: unknown): value is string {
  return typeof value === 'string' && projectPattern.test(value);
}

export function chatAppLink(project: string) {
  return `/builder?workspace=custom&project=${encodeURIComponent(project)}`;
}

export function featureBuilderEndpoint(workspace: string, project?: string) {
  const path = `/api/agent/builder/${workspace}`;
  return project && workspace === 'custom' ? `${path}?project=${encodeURIComponent(project)}` : path;
}

export function chatAppRequest(text: string, hasApp: boolean): boolean {
  const prompt = text.trim();
  if (/^\/app\s+\S/i.test(prompt)) return true;
  if (/^(?:how|why|what|which|where|when)\b|\b(?:explain|show me how|teach me how)\b/i.test(prompt)) return false;
  if (/\b(?:bwenge4biz|bwenge4profile|bwenge4research|myseb)\b/i.test(prompt)) return false;
  if (/\b(?:build|create|make|generate|code|develop|design|edit|update|redesign|improve)\b[^.!?]{0,90}\b(?:web\s*app(?:lication)?|application|app|website|prototype)\b/i.test(prompt)) return true;
  return hasApp && /^(?:please\s+)?(?:add|remove|change|edit|update|replace|move|fix|redesign|make|give|use|switch|rename)\b/i.test(prompt);
}
