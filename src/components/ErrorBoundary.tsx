/**
 * The last line of defence.
 *
 * A component that throws while rendering takes React's whole tree down with
 * it, and what the user sees is a white page — no message, no clue what
 * happened, nothing to click. That is the worst possible failure: the app looks
 * broken beyond repair when usually only one panel is at fault.
 *
 * This catches the throw, keeps the rest of the application standing, says what
 * went wrong, and gives a way back. Nothing that has been typed elsewhere is
 * lost, because the store is untouched.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { Button, Card } from './ui'

interface Props {
  children: ReactNode
  /** Changing this resets the boundary — used to recover on navigation. */
  resetKey?: string
}

interface State {
  error: Error | null
  stack: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidUpdate(previous: Props) {
    // Moving to another screen clears the failure, so one bad panel does not
    // leave the user stuck until they reload.
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, stack: '' })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? '' })
    console.error('[HUEREX] a screen failed to render', error, info.componentStack)
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <Card className="mt-6 p-6 max-w-2xl">
        <div className="flex items-start gap-3">
          <span className="size-9 shrink-0 rounded-xl bg-risk/10 grid place-items-center">
            <TriangleAlert className="size-4.5 text-risk" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">This screen could not be drawn</h2>
            <p className="text-sm text-ink-3 mt-1.5 leading-relaxed">
              Something went wrong rendering this panel. Nothing you have entered is lost — the rest of
              the application is still running, so you can move to another screen and carry on.
            </p>

            <div className="flex flex-wrap gap-2 mt-4">
              <Button
                variant="primary"
                icon={<RotateCcw className="size-4" />}
                onClick={() => this.setState({ error: null, stack: '' })}
              >
                Try this screen again
              </Button>
              <Button onClick={() => window.location.assign('/')}>Back to the dashboard</Button>
            </div>

            <details className="mt-5 group">
              <summary className="text-xs text-ink-3 cursor-pointer hover:text-ink-2 select-none">
                What went wrong, for reporting it
              </summary>
              <pre className="mt-2 text-2xs text-ink-2 font-mono whitespace-pre-wrap break-words bg-sunken rounded-lg p-3 max-h-64 overflow-y-auto leading-relaxed">
                {error.message}
                {stack ? `\n${stack.trim()}` : ''}
              </pre>
            </details>
          </div>
        </div>
      </Card>
    )
  }
}
