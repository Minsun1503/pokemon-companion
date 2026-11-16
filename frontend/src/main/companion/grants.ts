import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export type ApprovalRequest = {
  action_id: string
  digest: string
  scope_hash: string
  tool: string
  operation: string
  target: string
  origin: string
  path: string
  input_preview: string
  input_hash: string
  state_hash: string
  target_length: number
  input_length: number
  conversation: string
  scope_allowed: boolean
  reconciliation?: boolean
  wait_for_decision?: boolean
}
type Grant = {
  id: string
  digest: string
  scope_hash: string
  standing: boolean
  expires_at: number
  remaining: number
  signature: string
  reconciliation: boolean
}

/** Tokens stay in the companion main process. Renderer and model never receive them. */
export class ScopedGrants {
  private readonly grants = new Map<string, Grant>()
  constructor(
    private readonly key: Buffer,
    private readonly clock = Date.now,
  ) {}

  issue(request: ApprovalRequest, standing: boolean): void {
    if (standing && (!request.scope_allowed || request.reconciliation))
      throw new Error('Reusable approval requires a known conversation scope.')
    for (const [id, grant] of this.grants) if (grant.expires_at <= this.clock()) this.grants.delete(id)
    if (this.grants.size >= 128) this.grants.delete(this.grants.keys().next().value!)
    const payload = {
      id: randomUUID(),
      digest: request.digest,
      scope_hash: request.scope_hash,
      standing,
      reconciliation: request.reconciliation === true,
      expires_at: this.clock() + (standing ? 600000 : 30000),
      remaining: standing ? 20 : 1,
    }
    this.grants.set(payload.id, { ...payload, signature: this.sign(payload) })
  }

  consume(request: ApprovalRequest): boolean {
    for (const [id, grant] of this.grants) {
      const { signature, ...payload } = grant
      const expected = Buffer.from(this.sign(payload), 'hex')
      const received = Buffer.from(signature, 'hex')
      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected) ||
        grant.expires_at <= this.clock() ||
        grant.remaining <= 0
      ) {
        this.grants.delete(id)
        continue
      }
      if (
        grant.reconciliation !== (request.reconciliation === true) ||
        grant.scope_hash !== request.scope_hash ||
        (!grant.standing && grant.digest !== request.digest)
      )
        continue
      // Consumption is synchronous in the companion's single event loop, before execution is acknowledged.
      this.grants.delete(id)
      if (grant.remaining > 1) {
        const updated = { ...payload, remaining: grant.remaining - 1 }
        this.grants.set(id, { ...updated, signature: this.sign(updated) })
      }
      return true
    }
    return false
  }

  revokeAll(): void {
    this.grants.clear()
  }
  revokeScope(scope: string, includeReconciliation = false): void {
    for (const [id, grant] of this.grants)
      if (grant.scope_hash === scope && (includeReconciliation || !grant.reconciliation)) this.grants.delete(id)
  }
  private sign(payload: Omit<Grant, 'signature'>): string {
    return createHmac('sha256', this.key).update(JSON.stringify(payload)).digest('hex')
  }
}
