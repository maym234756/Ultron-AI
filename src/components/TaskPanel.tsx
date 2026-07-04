import { useEffect, useState } from 'react'
import { Check, CheckCircle, Clock, ListTodo, Plus, Trash2, X } from 'lucide-react'
import type { Task } from '../types'

const TODAY = new Date().toISOString().split('T')[0]
type Filter = 'pending' | 'today' | 'overdue' | 'done' | 'all'

interface Props {
  apiBase: string
  onClose: () => void
}

function relativeDate(due: string): { label: string; overdue: boolean } {
  if (due < TODAY) {
    const days = Math.round((new Date(TODAY + 'T00:00:00').getTime() - new Date(due + 'T00:00:00').getTime()) / 86400000)
    return { label: days === 1 ? '1 day overdue' : `${days}d overdue`, overdue: true }
  }
  if (due === TODAY) return { label: 'today', overdue: false }
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  if (due === tomorrow.toISOString().split('T')[0]) return { label: 'tomorrow', overdue: false }
  return { label: due, overdue: false }
}

function PriorityDot({ p }: { p: Task['priority'] }) {
  const colors: Record<Task['priority'], string> = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }
  return (
    <span
      style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colors[p], flexShrink: 0, marginTop: 4 }}
      title={`${p} priority`}
    />
  )
}

export function TaskPanel({ apiBase, onClose }: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('pending')
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState('')
  const [newPriority, setNewPriority] = useState<Task['priority']>('medium')
  const [newTags, setNewTags] = useState('')
  const [saving, setSaving] = useState(false)

  async function loadTasks() {
    setLoading(true)
    try {
      const r = await fetch(`${apiBase}/api/tasks`)
      if (r.ok) setTasks(((await r.json()) as { tasks: Task[] }).tasks ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadTasks() }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addTask() {
    if (!newTitle.trim() || saving) return
    setSaving(true)
    try {
      await fetch(`${apiBase}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          due: newDue || undefined,
          priority: newPriority,
          tags: newTags || undefined,
        }),
      })
      setNewTitle('')
      setNewDue('')
      setNewPriority('medium')
      setNewTags('')
      setShowAdd(false)
      await loadTasks()
    } finally {
      setSaving(false)
    }
  }

  async function markDone(id: string) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: true } : t))
    await fetch(`${apiBase}/api/tasks/${id}/done`, { method: 'PATCH' }).catch(() => {})
    await loadTasks()
  }

  async function deleteTask(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id))
    await fetch(`${apiBase}/api/tasks/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  function applyFilter(all: Task[]): Task[] {
    switch (filter) {
      case 'pending':  return all.filter(t => !t.done)
      case 'today':    return all.filter(t => !t.done && t.due === TODAY)
      case 'overdue':  return all.filter(t => !t.done && !!t.due && t.due < TODAY)
      case 'done':     return all.filter(t => t.done)
      default:         return all
    }
  }

  const filtered = applyFilter(tasks)
  const counts: Record<Filter, number> = {
    pending: tasks.filter(t => !t.done).length,
    today:   tasks.filter(t => !t.done && t.due === TODAY).length,
    overdue: tasks.filter(t => !t.done && !!t.due && t.due < TODAY).length,
    done:    tasks.filter(t => t.done).length,
    all:     tasks.length,
  }

  const FILTERS: [Filter, string][] = [
    ['pending', 'Pending'],
    ['today',   'Today'],
    ['overdue', 'Overdue'],
    ['done',    'Done'],
    ['all',     'All'],
  ]

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-tasks-wide" onClick={e => e.stopPropagation()}>

        <div className="panel-header">
          <div className="panel-title">
            <ListTodo size={16} />
            <span>Tasks</span>
            {counts.overdue > 0 && (
              <span className="task-overdue-badge">{counts.overdue} overdue</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className={`sidebar-action-btn ${showAdd ? 'observer-active' : ''}`}
              onClick={() => setShowAdd(s => !s)}
            >
              <Plus size={13} /> Add
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close tasks">
              <X size={18} />
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="task-add-form">
            <input
              autoFocus
              type="text"
              className="task-add-input"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void addTask() }}
              placeholder="Task title… (Enter to save)"
            />
            <div className="task-add-row">
              <input
                type="date"
                className="task-add-date"
                value={newDue}
                min={TODAY}
                onChange={e => setNewDue(e.target.value)}
                title="Due date"
              />
              <select
                className="task-add-select"
                value={newPriority}
                onChange={e => setNewPriority(e.target.value as Task['priority'])}
              >
                <option value="high">🔴 High</option>
                <option value="medium">🟡 Medium</option>
                <option value="low">🟢 Low</option>
              </select>
              <input
                type="text"
                className="task-add-tags"
                value={newTags}
                onChange={e => setNewTags(e.target.value)}
                placeholder="tags, comma-separated"
              />
              <button
                type="button"
                className="sidebar-action-btn"
                onClick={() => void addTask()}
                disabled={!newTitle.trim() || saving}
              >
                {saving ? '…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <div className="task-tabs">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              type="button"
              className={`task-tab ${filter === f ? 'active' : ''} ${f === 'overdue' && counts.overdue > 0 ? 'has-overdue' : ''}`}
              onClick={() => setFilter(f)}
            >
              {label}
              {counts[f] > 0 && (
                <span className={`task-tab-count ${f === 'overdue' && counts.overdue > 0 ? 'overdue' : ''}`}>
                  {counts[f]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="panel-body task-list-body">
          {loading && <p className="panel-hint">Loading tasks…</p>}

          {!loading && filtered.length === 0 && (
            <div className="task-empty-state">
              <CheckCircle size={28} />
              <p>
                {filter === 'overdue' ? 'Nothing overdue — great work!' :
                 filter === 'today'   ? 'Nothing due today.' :
                 filter === 'done'    ? 'No completed tasks yet.' :
                 tasks.length === 0   ? 'No tasks. Click Add to create one, or ask the agent to add tasks for you.' :
                 'No tasks in this view.'}
              </p>
            </div>
          )}

          {!loading && filtered.map(task => {
            const isOverdue = !task.done && !!task.due && task.due < TODAY
            const dueInfo = task.due ? relativeDate(task.due) : null
            return (
              <div key={task.id} className={`task-card ${task.done ? 'task-done' : ''} ${isOverdue ? 'task-overdue' : ''}`}>
                <button
                  type="button"
                  className={`task-check ${task.done ? 'checked' : ''}`}
                  onClick={() => !task.done && void markDone(task.id)}
                  disabled={task.done}
                  title={task.done ? 'Completed' : 'Mark as done'}
                >
                  {task.done && <Check size={10} />}
                </button>

                <div className="task-body-content">
                  <div className="task-title-line">
                    <PriorityDot p={task.priority} />
                    <span className="task-title">{task.title}</span>
                  </div>
                  {task.notes && <p className="task-notes">{task.notes}</p>}
                  <div className="task-meta-row">
                    {dueInfo && (
                      <span className={`task-due-label ${dueInfo.overdue ? 'overdue' : ''}`}>
                        <Clock size={9} /> {dueInfo.label}
                      </span>
                    )}
                    {task.tags.map(tag => (
                      <span key={tag} className="task-chip">#{tag}</span>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className="task-del"
                  onClick={() => void deleteTask(task.id)}
                  title="Delete task"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
