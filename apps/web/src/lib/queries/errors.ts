// A bad query parameter. withApi turns it into 400 {error: 'bad_request', issues}.
export type ParamIssue = { path: (string | number)[]; code: string; message: string }

export class ParamError extends Error {
  readonly issues: ParamIssue[]
  constructor(issues: ParamIssue[]) {
    super(issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; '))
    this.name = 'ParamError'
    this.issues = issues
  }
}
