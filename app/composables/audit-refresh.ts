/**
 * A successful settings or member change on this page bumps the counter.
 * AuditLog watches it and reloads, so the new row shows without Refresh.
 */
export function useAuditRefresh() {
  const generation = useState('audit-log-generation', () => 0)

  function notifyAuditChanged() {
    generation.value += 1
  }

  return { generation, notifyAuditChanged }
}
