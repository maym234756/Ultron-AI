import { useEffect, useState } from 'react'
import { Building2, Loader, RefreshCw, ShieldCheck, ShieldOff, X } from 'lucide-react'
import type { AuthUser } from './AuthPanel'

type ToastType = 'success' | 'error' | 'info'

type OrganizationRole = 'owner' | 'member'

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

type IdentityOverview = {
  totals: {
    userCount: number
    organizationCount: number
    platformAdminCount: number
    pendingInviteCount: number
  }
  organizations: Array<{
    id: string
    name: string
    slug: string
    createdAt: string
    updatedAt: string
    pendingInviteCount: number
    members: OrganizationMemberSummary[]
  }>
}

type AuditLogEntry = {
  id: string
  action: string
  summary: string
  createdAt: string
  user: {
    id: string
    email: string
    displayName: string
  } | null
}

type Props = {
  apiBase: string
  currentUser: AuthUser
  onClose: () => void
  refreshAuth: () => Promise<void>
  onNotice: (message: string, type?: ToastType) => void
}

export function AdminIdentityPanel({ apiBase, currentUser, onClose, refreshAuth, onNotice }: Props) {
  const [overview, setOverview] = useState<IdentityOverview | null>(null)
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState('')
  const [error, setError] = useState('')

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const [response, auditResponse] = await Promise.all([
        fetch(`${apiBase}/api/admin/identity`, { credentials: 'include' }),
        fetch(`${apiBase}/api/admin/audit?limit=40`, { credentials: 'include' }),
      ])
      const data = await response.json() as IdentityOverview & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not load identity overview')
      setOverview(data)
      if (auditResponse.ok) {
        const auditData = await auditResponse.json() as { entries?: AuditLogEntry[] }
        setAuditEntries(auditData.entries ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load identity overview')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setPlatformAdmin(memberId: string, enabled: boolean) {
    if (busyUserId) return
    setBusyUserId(memberId)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/admin/users/${encodeURIComponent(memberId)}/platform-admin`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPlatformAdmin: enabled }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not update platform admin access')
      await refresh()
      if (memberId === currentUser.id) await refreshAuth()
      onNotice(enabled ? 'Platform admin access granted.' : 'Platform admin access removed.', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update platform admin access')
    } finally {
      setBusyUserId('')
    }
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide" onClick={event => event.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <ShieldCheck size={16} />
            <span>Platform Identity Admin</span>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="sidebar-action-btn" onClick={() => void refresh()} disabled={loading || Boolean(busyUserId)}>
              {loading ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close identity admin panel">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="panel-body project-builder-body">
          <section className="project-builder-hero org-admin-hero">
            <div>
              <span className="settings-section-title">Platform Overview</span>
              <h3>Identity and Workspace Map</h3>
              <p>Review organizations, members, and platform admin access across the current Lumivex AI runtime.</p>
            </div>
            <Building2 size={34} />
          </section>

          {error && <div className="project-builder-error">{error}</div>}

          {overview && (
            <>
              <section className="org-summary-grid">
                <article className="org-summary-card">
                  <strong>{overview.totals.userCount}</strong>
                  <span>Accounts</span>
                </article>
                <article className="org-summary-card">
                  <strong>{overview.totals.organizationCount}</strong>
                  <span>Organizations</span>
                </article>
                <article className="org-summary-card">
                  <strong>{overview.totals.platformAdminCount}</strong>
                  <span>Platform admins</span>
                </article>
                <article className="org-summary-card">
                  <strong>{overview.totals.pendingInviteCount}</strong>
                  <span>Pending invites</span>
                </article>
              </section>

              <section className="project-builder-projects org-card-stack">
                <div className="project-builder-section-head">
                  <span className="settings-section-title">Organizations</span>
                  <span className="panel-hint">{overview.organizations.length} workspace record(s)</span>
                </div>

                {overview.organizations.map(org => (
                  <article className="org-admin-org" key={org.id}>
                    <div className="org-member-head">
                      <div className="org-member-meta">
                        <strong>{org.name}</strong>
                        <span>{org.slug} · {org.members.length} member(s) · {org.pendingInviteCount} pending invite(s)</span>
                      </div>
                    </div>

                    <div className="org-admin-members">
                      {org.members.map(member => (
                        <article className="org-member-card" key={member.id}>
                          <div className="org-member-head">
                            <div className="org-member-meta">
                              <strong>{member.displayName}{member.id === currentUser.id ? ' · You' : ''}</strong>
                              <span>{member.email} · @{member.username}</span>
                              <div className="org-badge-row">
                                <span className={`org-badge ${member.organizationRole}`}>{member.organizationRole === 'owner' ? 'Owner' : 'Member'}</span>
                                {member.isPlatformAdmin && <span className="org-badge admin">Platform admin</span>}
                                {member.emailVerifiedAt ? <span className="org-badge verified">Verified</span> : <span className="org-badge invite">Needs verification</span>}
                              </div>
                            </div>

                            <div className="project-builder-actions">
                              <button
                                type="button"
                                onClick={() => void setPlatformAdmin(member.id, !member.isPlatformAdmin)}
                                disabled={busyUserId === member.id}
                              >
                                {busyUserId === member.id
                                  ? <Loader size={13} className="spin" />
                                  : member.isPlatformAdmin
                                    ? <ShieldOff size={13} />
                                    : <ShieldCheck size={13} />}
                                {member.isPlatformAdmin ? 'Remove Platform Admin' : 'Grant Platform Admin'}
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </article>
                ))}
              </section>

              <section className="project-builder-projects org-card-stack">
                <div className="project-builder-section-head">
                  <span className="settings-section-title">Audit Log</span>
                  <span className="panel-hint">{auditEntries.length} recent event(s)</span>
                </div>

                {auditEntries.length === 0 && <p className="panel-hint">No audit entries recorded yet.</p>}
                {auditEntries.map(entry => (
                  <article className="org-member-card" key={entry.id}>
                    <div className="org-member-meta">
                      <strong>{entry.action}</strong>
                      <span>{entry.summary}</span>
                      <span>{new Date(entry.createdAt).toLocaleString()} · {entry.user?.displayName ?? entry.user?.email ?? 'System'}</span>
                    </div>
                  </article>
                ))}
              </section>
            </>
          )}

          {loading && !overview && !error && (
            <p className="panel-hint">Loading platform identity data...</p>
          )}
        </div>
      </div>
    </div>
  )
}