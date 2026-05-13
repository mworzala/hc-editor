import { Component, type ErrorInfo, type ReactNode } from 'react'

// React error boundaries are still class-only as of React 19. Two flavors
// live here:
//
//  • <AppErrorBoundary>  — top-level fallback. Renders a centered apology +
//    a "Reload" button. Used to wrap the whole app in main.tsx.
//
//  • <PaneErrorBoundary> — wraps each editor/tool render so a single bad tab
//    can't crash the rest of the workspace. Surfaces the error inline with a
//    "Close tab" action provided by the consumer.
//
// Both reset on `resetKey` change so callers can recover by remounting (e.g.
// the user closes the offending tab and the boundary re-tries on the new tab).

type AppBoundaryProps = {
    children: ReactNode
    /** Optional custom fallback. Receives the captured error and a reset fn. */
    fallback?: (error: Error, reset: () => void) => ReactNode
}

type State = { error: Error | null }

export class AppErrorBoundary extends Component<AppBoundaryProps, State> {
    override state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    override componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[AppErrorBoundary]', error, info.componentStack)
    }

    private reset = () => this.setState({ error: null })

    override render() {
        if (!this.state.error) return this.props.children
        if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
        return (
            <div className='bg-background text-foreground flex h-svh w-full flex-col items-center justify-center gap-4 p-6 text-center'>
                <div className='flex flex-col gap-1'>
                    <h1 className='text-lg font-medium'>Something went wrong.</h1>
                    <p className='text-muted-foreground text-sm'>{this.state.error.message}</p>
                </div>
                <button
                    type='button'
                    onClick={() => window.location.reload()}
                    className='bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-sm font-medium'
                >
                    Reload
                </button>
            </div>
        )
    }
}

type PaneBoundaryProps = {
    children: ReactNode
    /** Identifier used to auto-reset when the wrapped tab changes. */
    resetKey: string
    /** Label for the action that lets the user dismiss the failing pane. */
    onClose?: () => void
}

type PaneState = { error: Error | null; resetKey: string }

export class PaneErrorBoundary extends Component<PaneBoundaryProps, PaneState> {
    override state: PaneState = { error: null, resetKey: this.props.resetKey }

    static getDerivedStateFromError(error: Error): Partial<PaneState> {
        return { error }
    }

    static getDerivedStateFromProps(props: PaneBoundaryProps, state: PaneState): PaneState | null {
        // Auto-reset when the wrapped tab swaps in.
        if (props.resetKey !== state.resetKey) {
            return { error: null, resetKey: props.resetKey }
        }
        return null
    }

    override componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[PaneErrorBoundary]', this.props.resetKey, error, info.componentStack)
    }

    private reset = () => this.setState({ error: null, resetKey: this.props.resetKey })

    override render() {
        if (!this.state.error) return this.props.children
        return (
            <div className='text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-xs'>
                <div className='flex flex-col gap-1'>
                    <div className='text-foreground text-sm font-medium'>This pane crashed.</div>
                    <code className='text-[0.7rem] break-all'>{this.state.error.message}</code>
                </div>
                <div className='flex gap-2'>
                    <button
                        type='button'
                        onClick={this.reset}
                        className='bg-muted hover:bg-muted/80 rounded-md px-2 py-1 text-xs'
                    >
                        Retry
                    </button>
                    {this.props.onClose ? (
                        <button
                            type='button'
                            onClick={this.props.onClose}
                            className='bg-muted hover:bg-muted/80 rounded-md px-2 py-1 text-xs'
                        >
                            Close tab
                        </button>
                    ) : null}
                </div>
            </div>
        )
    }
}
