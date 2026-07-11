import { useEffect, useState } from 'react'
import { ArrowRightLeft, Building2, Crown, Loader, LogOut, Mail, RefreshCw, Send, ShieldCheck, Trash2, UserRound, X } from 'lucide-react'
import type { AuthUser } from './AuthPanel'

type ToastType = 'success' | 'error' | 'info'

type OrganizationRole = 'owner' | 'member'

type OrganizationInviteDelivery =
  | {
    mode: 'debug'
    email: string
    inviteToken: string
    acceptUrl: string
    expiresAt: string
  }
  | {
    mode: 'email'
    provider: 'smtp'
    email: string
    expiresAt: string
    messageId?: string
  }

type OrganizationMemberSummary = {
  id: string
  email: string
  username: string
  displayName: string
  organizationRole: OrganizationRole
  isPlatformAdmin: boolean
  emailVerifiedAt: string | null
  createdAt: string
}

type OrganizationInviteSummary = {
  id: string
  email: string
  role: OrganizationRole
  expiresAt: string
  createdAt: string
  invitedBy: {
    id: string
    email: string
    displayName: string
  } | null
}

type IncomingOrganizationInviteSummary = {
  id: string
  role: OrganizationRole
  expiresAt: string
  createdAt: string
  organization: {
    id: string
    name: string
    slug: string
  }
  invitedBy: {
    id: string
    email: string
    displayName: string
  } | null
}

type OrganizationOverview = {
  organization: {
    id: string
    name: string
    slug: string
    createdAt: string
    updatedAt: string
  }
  currentUser: {
    id: string
    organizationRole: OrganizationRole
    isPlatformAdmin: boolean
    canManageOrganization: boolean
  }
  members: OrganizationMemberSummary[]
  invites: OrganizationInviteSummary[]
}

type CreatedOrganizationInvite = {
  id: string
  email: string
  role: OrganizationRole
  expiresAt: string
  delivery: OrganizationInviteDelivery
}

type Props = {
  apiBase: string
  currentUser: AuthUser
  onClose: () => void
  refreshAuth: () => Promise<void>
  onNotice: (message: string, type?: ToastType) => void
}

function formatRole(role: OrganizationRole): string {
  return role === 'owner' ? 'Owner' : 'Member'
}

function relativeExpiry(value: string): string {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function OrganizationPanel({ apiBase, currentUser, onClose, refreshAuth, onNotice }: Props) {
  const [overview, setOverview] = useState<OrganizationOverview | null>(null)
  const [incomingInvites, setIncomingInvites] = useState<IncomingOrganizationInviteSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrganizationRole>('member')
  const [inviteNote, setInviteNote] = useState('')

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const [overviewResponse, incomingResponse] = await Promise.all([
        fetch(`${apiBase}/api/org`, { credentials: 'include' }),
        fetch(`${apiBase}/api/org/invites/incoming`, { credentials: 'include' }),
      ])

      const overviewData = await overviewResponse.json() as OrganizationOverview & { error?: string }
      const incomingData = await incomingResponse.json() as { invites?: IncomingOrganizationInviteSummary[]; error?: string }

      if (!overviewResponse.ok) throw new Error(overviewData.error ?? 'Could not load workspace')
      if (!incomingResponse.ok) throw new Error(incomingData.error ?? 'Could not load incoming invites')

      setOverview(overviewData)
      setIncomingInvites(incomingData.invites ?? [])
      setWorkspaceName(overviewData.organization.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workspace')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [apiBase, currentUser.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runAction(actionId: string, task: () => Promise<void>) {
    if (busyAction) return
    setBusyAction(actionId)
    setError('')
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace action failed')
    } finally {
      setBusyAction('')
    }
  }

  async function saveWorkspaceName(event: React.FormEvent) {
    event.preventDefault()
    await runAction('rename', async () => {
      const response = await fetch(`${apiBase}/api/org`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workspaceName }),
      })
      const data = await response.json() as OrganizationOverview & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not rename workspace')
      setOverview(data)
      onNotice('Workspace name updated.', 'success')
    })
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault()
    await runAction('invite', async () => {
      const response = await fetch(`${apiBase}/api/org/invites`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      const data = await response.json() as CreatedOrganizationInvite & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not create invite')

      setInviteEmail('')
      setInviteRole('member')
      setInviteNote(data.delivery.mode === 'debug'
        ? `Debug invite for ${data.delivery.email}: token ${data.delivery.inviteToken} · ${data.delivery.acceptUrl}`
        : `Invite email sent to ${data.email}.`)
      await refresh()
      onNotice(data.delivery.mode === 'debug' ? 'Invite created in debug mode.' : 'Invite sent by email.', 'success')
    })
  }

  async function cancelInvite(inviteId: string) {
    await runAction(`cancel-${inviteId}`, async () => {
      const response = await fetch(`${apiBase}/api/org/invites/${encodeURIComponent(inviteId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await response.json() as OrganizationOverview & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not cancel invite')
      setOverview(data)
      onNotice('Invite cancelled.', 'success')
    })
  }

  async function acceptIncomingInvite(inviteId: string) {
    await runAction(`accept-${inviteId}`, async () => {
      const response = await fetch(`${apiBase}/api/org/invites/${encodeURIComponent(inviteId)}/accept`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json() as { organization?: OrganizationOverview; user?: AuthUser; error?: string }
      if (!response.ok || !data.organization) throw new Error(data.error ?? 'Could not accept invite')
      setOverview(data.organization)
      setIncomingInvites(current => current.filter(invite => invite.id !== inviteId))
      await refreshAuth()
      onNotice(`Joined ${data.organization.organization.name}.`, 'success')
    })
  }

  async function updateMemberRole(memberId: string, role: OrganizationRole) {
    await runAction(`role-${memberId}-${role}`, async () => {
      const response = await fetch(`${apiBase}/api/org/members/${encodeURIComponent(memberId)}/role`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = await response.json() as { member?: OrganizationMemberSummary; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not update role')
      await refresh()
      onNotice(`Member updated to ${formatRole(role).toLowerCase()}.`, 'success')
    })
  }

  async function transferOwnership(memberId: string) {
    await runAction(`transfer-${memberId}`, async () => {
      const response = await fetch(`${apiBase}/api/org/members/${encodeURIComponent(memberId)}/transfer-ownership`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json() as { organization?: OrganizationOverview; user?: AuthUser; error?: string }
      if (!response.ok || !data.organization) throw new Error(data.error ?? 'Could not transfer ownership')
      setOverview(data.organization)
      await refreshAuth()
      onNotice('Ownership transferred.', 'success')
    })
  }

  async function removeMember(memberId: string) {
    if (!window.confirm('Remove this member from the workspace?')) return
    await runAction(`remove-${memberId}`, async () => {
      const response = await fetch(`${apiBase}/api/org/members/${encodeURIComponent(memberId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await response.json() as OrganizationOverview & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not remove member')
      setOverview(data)
      onNotice('Member removed from workspace.', 'success')
    })
  }

  async function leaveWorkspace() {
    if (!window.confirm('Leave this workspace and return to a personal workspace?')) return
    await runAction('leave', async () => {
      const response = await fetch(`${apiBase}/api/org/leave`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json() as { organization?: OrganizationOverview; user?: AuthUser; error?: string }
      if (!response.ok || !data.organization) throw new Error(data.error ?? 'Could not leave workspace')
      setOverview(data.organization)
      setWorkspaceName(data.organization.organization.name)
      await refreshAuth()
      onNotice('Returned to your personal workspace.', 'success')
    })
  }

  const canManage = overview?.currentUser.canManageOrganization ?? false
  const isOwner = overview?.currentUser.organizationRole === 'owner'
  const memberCount = overview?.members.length ?? 0

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide" onClick={event => event.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Building2 size={16} />
            <span>Workspace Control</span>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="sidebar-action-btn" onClick={() => void refresh()} disabled={loading || Boolean(busyAction)}>
              {loading ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close workspace panel">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="panel-body project-builder-body">
          <section className="project-builder-hero org-hero">
            <div>
              <span className="settings-section-title">Workspace Engine</span>
              <h3>{overview?.organization.name ?? currentUser.organizationName ?? 'Workspace'}</h3>
              <p>
                {currentUser.organizationRole === 'owner' ? 'You control membership and invites for this workspace.' : 'You can review members, incoming invites, and your workspace status here.'}
              </p>
            </div>
            <ShieldCheck size={34} />
          </section>

          {error && <div className="project-builder-error">{error}</div>}
          {inviteNote && <div className="panel-hint org-invite-note">{inviteNote}</div>}

          {overview && (
            <>
              <section className="org-summary-grid">
                <article className="org-summary-card">
                  <strong>{overview.members.length}</strong>
                  <span>Member{overview.members.length === 1 ? '' : 's'}</span>
                </article>
                <article className="org-summary-card">
                  <strong>{overview.invites.length}</strong>
                  <span>Pending outgoing invite{overview.invites.length === 1 ? '' : 's'}</span>
                </article>
                <article className="org-summary-card">
                  <strong>{incomingInvites.length}</strong>
                  <span>Incoming invite{incomingInvites.length === 1 ? '' : 's'}</span>
                </article>
              </section>

              <section className="project-builder-projects org-card-stack">
                <div className="project-builder-section-head">
                  <span className="settings-section-title">Workspace Settings</span>
                  <span className="panel-hint">Slug: {overview.organization.slug}</span>
                </div>
                {canManage ? (
                  <form className="org-inline-form" onSubmit={event => void saveWorkspaceName(event)}>
                    <label className="project-builder-field">
                      <span>Workspace name</span>
                      <input value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} />
                    </label>
                    <button className="project-builder-run" type="submit" disabled={busyAction === 'rename' || !workspaceName.trim()}>
                      {busyAction === 'rename' ? <Loader size={15} className="spin" /> : <Send size={15} />}
                      Save Name
                    </button>
                  </form>
                ) : (
                  <p className="panel-hint">Only workspace owners can rename this workspace.</p>
                )}

                <div className="project-builder-actions">
                  <button type="button" onClick={() => void leaveWorkspace()} disabled={busyAction === 'leave' || memberCount <= 1}>
                    <LogOut size={13} />
                    Leave Workspace
                  </button>
                </div>
              </section>

              <section className="project-builder-projects org-card-stack">
                <div className="project-builder-section-head">
                  <span className="settings-section-title">Incoming Invites</span>
                  <span className="panel-hint">Invites sent to {currentUser.email}</span>
                </div>
                {incomingInvites.length === 0 && <p className="panel-hint">No incoming invites right now.</p>}
                {incomingInvites.map(invite => (
                  <article className="org-member-card" key={invite.id}>
                    <div className="org-member-head">
                      <div className="org-member-meta">
                        <strong>{invite.organization.name}</strong>
                        <span>{formatRole(invite.role)} · Expires {relativeExpiry(invite.expiresAt)}</span>
                        {invite.invitedBy && <span>Invited by {invite.invitedBy.displayName} · {invite.invitedBy.email}</span>}
                      </div>
                      <div className="project-builder-actions">
                        <button type="button" className="project-next-action" onClick={() => void acceptIncomingInvite(invite.id)} disabled={busyAction === `accept-${invite.id}`}>
                          {busyAction === `accept-${invite.id}` ? <Loader size={13} className="spin" /> : <Mail size={13} />}
                          Accept Invite
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </section>

              {canManage && (
                <section className="project-builder-projects org-card-stack">
                  <div className="project-builder-section-head">
                    <span className="settings-section-title">Invite Members</span>
                    <span className="panel-hint">Invite by email and choose their starting role.</span>
                  </div>

                  <form className="org-inline-form org-invite-form" onSubmit={event => void sendInvite(event)}>
                    <label className="project-builder-field">
                      <span>Email</span>
                      <input value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="teammate@example.com" />
                    </label>
                    <label className="project-builder-field">
                      <span>Role</span>
                      <select value={inviteRole} onChange={event => setInviteRole(event.target.value as OrganizationRole)}>
                        <option value="member">Member</option>
                        <option value="owner">Owner</option>
                      </select>
                    </label>
                    <button className="project-builder-run" type="submit" disabled={busyAction === 'invite' || !inviteEmail.trim()}>
                      {busyAction === 'invite' ? <Loader size={15} className="spin" /> : <Send size={15} />}
                      Create Invite
                    </button>
                  </form>

                  {overview.invites.length === 0 && <p className="panel-hint">No pending outgoing invites.</p>}
                  {overview.invites.map(invite => (
                    <article className="org-member-card" key={invite.id}>
                      <div className="org-member-head">
                        <div className="org-member-meta">
                          <strong>{invite.email}</strong>
                          <span>{formatRole(invite.role)} · Expires {relativeExpiry(invite.expiresAt)}</span>
                          {invite.invitedBy && <span>Sent by {invite.invitedBy.displayName}</span>}
                        </div>
                        <div className="project-builder-actions">
                          <button type="button" onClick={() => void cancelInvite(invite.id)} disabled={busyAction === `cancel-${invite.id}`}>
                            {busyAction === `cancel-${invite.id}` ? <Loader size={13} className="spin" /> : <Trash2 size={13} />}
                            Cancel Invite
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </section>
              )}

              <section className="project-builder-projects org-card-stack">
                <div className="project-builder-section-head">
                  <span className="settings-section-title">Members</span>
                  <span className="panel-hint">Manage owners, members, and removals.</span>
                </div>
                {overview.members.map(member => {
                  const isSelf = member.id === overview.currentUser.id
                  return (
                    <article className="org-member-card" key={member.id}>
                      <div className="org-member-head">
                        <div className="org-member-meta">
                          <strong>{member.displayName}{isSelf ? ' · You' : ''}</strong>
                          <span>{member.email} · @{member.username}</span>
                          <div className="org-badge-row">
                            <span className={`org-badge ${member.organizationRole}`}>{formatRole(member.organizationRole)}</span>
                            {member.isPlatformAdmin && <span className="org-badge admin">Platform admin</span>}
                            {member.emailVerifiedAt ? <span className="org-badge verified">Verified</span> : <span className="org-badge invite">Needs verification</span>}
                          </div>
                        </div>

                        {canManage && !isSelf && (
                          <div className="project-builder-actions">
                            {member.organizationRole === 'member' ? (
                              <button type="button" onClick={() => void updateMemberRole(member.id, 'owner')} disabled={busyAction === `role-${member.id}-owner`}>
                                <Crown size={13} />
                                Make Owner
                              </button>
                            ) : (
                              <button type="button" onClick={() => void updateMemberRole(member.id, 'member')} disabled={busyAction === `role-${member.id}-member`}>
                                <UserRound size={13} />
                                Make Member
                              </button>
                            )}
                            {isOwner && member.organizationRole !== 'owner' && (
                              <button type="button" onClick={() => void transferOwnership(member.id)} disabled={busyAction === `transfer-${member.id}`}>
                                <ArrowRightLeft size={13} />
                                Transfer Ownership
                              </button>
                            )}
                            <button type="button" onClick={() => void removeMember(member.id)} disabled={busyAction === `remove-${member.id}`}>
                              <Trash2 size={13} />
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  )
                })}
              </section>
            </>
          )}

          {loading && !overview && !error && (
            <p className="panel-hint">Loading workspace controls...</p>
          )}
        </div>
      </div>
    </div>
  )
}