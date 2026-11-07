// Названия хостингов для человека (провайдер проекта в API — github,
// gitlab, gitea). Неизвестный провайдер показывается как есть.
export const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub', gitlab: 'GitLab', gitea: 'Gitea / Forgejo',
}

export function providerLabel(p: string): string {
  return PROVIDER_LABEL[p] ?? p
}
