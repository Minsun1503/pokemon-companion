type ApprovalData = {
  tool: string
  operation: string
  target: string
  origin: string
  path: string
  input_preview: string
  input_length: number
  target_length: number
  conversation: string
  scope_allowed: boolean
  reconciliation?: boolean
}
const approvalBridge = (
  window as unknown as {
    approvalUI: { load: () => Promise<ApprovalData | null>; decide: (value: boolean | 'deny') => Promise<boolean> }
  }
).approvalUI
void approvalBridge.load().then((request) => {
  if (!request) {
    document.body.textContent = 'This approval request is no longer available.'
    return
  }
  const details = document.getElementById('details')!
  for (const [label, value] of [
    ['Tool', request.tool],
    ['Action', request.operation],
    ['Origin', request.origin],
    ['Page', request.path],
    ['Conversation', request.conversation || 'Unknown — reusable approval unavailable'],
    ['Target', `${request.target} (${request.target_length} characters before display capping)`],
  ]) {
    const term = document.createElement('dt'),
      description = document.createElement('dd')
    term.textContent = label
    description.textContent = value
    details.append(term, description)
  }
  document.getElementById('preview')!.textContent =
    `${request.input_length} characters: ${request.input_preview || '(No text input)'}`
  const scope = document.getElementById('scope')
  if (scope) scope.hidden = !request.scope_allowed || request.reconciliation === true
  if (request.reconciliation) {
    const heading = document.querySelector('h1')
    if (heading) heading.textContent = 'Review an uncertain outcome'
    const once = document.getElementById('once')
    if (once) once.textContent = 'I checked the outcome — allow a new approval'
    const explanation = document.getElementById('explanation')
    if (explanation)
      explanation.textContent =
        'Check the app yourself to determine whether the action happened. This records your review, revokes earlier approvals, and sends no input.'
  }
  for (const [id, choice] of [
    ['deny', 'deny'],
    ['once', false],
    ['scope', true],
  ] as const) {
    document.getElementById(id)!.addEventListener('click', () => {
      void approvalBridge.decide(choice).then((ok) => {
        if (!ok) document.getElementById('status')!.textContent = 'Approval could not be recorded. Please try again.'
      })
    })
  }
})
