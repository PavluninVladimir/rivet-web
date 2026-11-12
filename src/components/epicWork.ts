import type { Task, TeamAgent } from '../api/client'
import { stepTitle } from './taskProcess.ts'
import { stepVerb } from './roleLabels.ts'

export function taskWork(task: Task, team: TeamAgent[]) {
  // RunnerID may retain the coder after its stage ends. Only the cur fields
  // from an open assigned run identify current work; a developer pin does not.
  const assigned = ['running', 'fixing', 'testing', 'review'].includes(task.Status)
    && task.Step !== 'merge' && !task.WaitReason
    && !!(task.AgentID || task.AgentName || task.RoleID || task.RunnerName)
  const agent = team.find(a => a.busy && a.id === task.AgentID && a.task_id === task.ID && a.epic_id === task.EpicID)
  const stage = stepTitle({ id: task.Step || task.Status, kind: agent?.step || task.Step })
  let label = task.WaitReason || task.BlockReason
  if (assigned) label = task.Status === 'fixing' ? stepVerb('code', 'changes') : stage
  else if (!label) {
    if (task.Step === 'merge') label = 'Ожидает слияния'
    else if (task.Status === 'failed') label = 'Ошибка выполнения'
    else if (task.Status === 'blocked') label = 'Заблокирована'
    else if (task.Step === 'prompt') label = 'Ожидает участника шага'
    else if (task.Status === 'ready') label = 'Ожидает назначения'
    else label = `Ожидает исполнителя шага «${stage}»`
  }
  return { assigned, label, agentName: task.AgentName || agent?.name || task.AgentID,
    roleId: task.RoleID || agent?.role_id, runnerName: task.RunnerName }
}
