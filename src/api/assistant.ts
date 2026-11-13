import { request } from './client.ts'
export interface AssistantLimits {
  max_run_actions: number
  max_run_seconds: number
  max_input_tokens: number
  max_output_tokens: number
  daily_tokens: number
  daily_cost_usd: number | null
}
export interface AssistantConfig {
  revision: number
  enabled: boolean
  sponsor_user_id: string | null
  connection_id: string | null
  model_id: string | null
  limits: AssistantLimits
}
export interface EvidenceRef {
  id: string
  kind: string
  resource_id: string
  revision: string | null
  observed_at: string
  label: string
  url: string
  excerpt?: string
}
export interface AssistantSnapshot {
  revision: string
  event_cursor: string
  computed_at: string
  facts: {
    id: string
    kind: string
    resource_id: string
    value: Record<string, unknown>
    ref_ids: string[]
  }[]
  refs: EvidenceRef[]
  capabilities: string[]
}
export interface AssistantRun {
  id: string
  revision: number
  status: string
  trigger: string
  initiator_id: string
  snapshot_revision: string
  created_at: string
  finished_at: string | null
  summary: string | null
  uncertainties: string[]
  usage: { input_tokens: number; output_tokens: number; cost_usd: number | null }
  stale: boolean
  followups?: { type: string; target_id: string; reason: string; url: string }[]
}
export interface AssistantMessage {
  id: string
  author: 'user' | 'assistant'
  actor_id: string | null
  text: string
  created_at: string
  run_id: string | null
  ref_ids: string[]
}
export interface AssistantAction {
  id: string
  run_id: string
  type: string
  target_id: string
  status: string
  guard: { decision: string; code: string; message: string }
  evidence_ids: string[]
  operation_id: string | null
  result: { resource_status?: string; effect_ref?: string; url?: string; decision_url?: string } | null
  created_at: string
  finished_at: string | null
}
export interface AssistantView {
  capability: boolean
  config: AssistantConfig
  snapshot: AssistantSnapshot
  active_run: AssistantRun | null
}
const path = (p: string) => `/projects/${encodeURIComponent(p)}/assistant`
export const assistantApi = {
  view: (p: string) => request<AssistantView>('GET', path(p)),
  messages: (p: string, before?: string) =>
    request<{ items: AssistantMessage[]; next_cursor: string | null }>(
      'GET',
      `${path(p)}/messages?limit=50${before ? '&before=' + encodeURIComponent(before) : ''}`
    ),
  run: (p: string, id: string) =>
    request<{ run: AssistantRun; actions: AssistantAction[] }>(
      'GET',
      `${path(p)}/runs/${encodeURIComponent(id)}`
    ),
  send: (p: string, text: string, intent: 'question' | 'recover', revision: string, key: string) =>
    request<{ message: AssistantMessage; run: AssistantRun }>(
      'POST',
      `${path(p)}/messages`,
      { text, intent, expected_snapshot_revision: revision },
      undefined,
      { 'Idempotency-Key': key }
    ),
  configure: (p: string, c: AssistantConfig) =>
    request<AssistantConfig>('PATCH', `${path(p)}/config`, {
      expected_revision: c.revision,
      enabled: c.enabled,
      connection_id: c.connection_id,
      model_id: c.model_id,
      limits: c.limits
    }),
  stop: (p: string, r: AssistantRun, key: string) =>
    request<AssistantRun>(
      'POST',
      `${path(p)}/runs/${r.id}/stop`,
      { expected_revision: r.revision },
      undefined,
      { 'Idempotency-Key': key }
    )
}
