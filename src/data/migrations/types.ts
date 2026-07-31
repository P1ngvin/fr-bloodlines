/**
 * A migration lifts a project document from formatVersion N to N+1.
 * Input/output are untyped envelopes — only this layer knows legacy shapes.
 */
export type Migration = {
  from: number
  to: number
  migrate: (document: Record<string, unknown>) => Record<string, unknown>
}
