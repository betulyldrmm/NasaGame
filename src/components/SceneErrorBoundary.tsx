import { Component, type ErrorInfo, type ReactNode } from 'react'

interface SceneErrorBoundaryProps {
  children: ReactNode
  message: string
}

interface SceneErrorBoundaryState {
  failed: boolean
}

/** Contains lazy-load and render failures from the optional Phaser scene. */
export class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, SceneErrorBoundaryState> {
  state: SceneErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Flight scene failed to load.', error, info.componentStack)
  }

  render() {
    if (this.state.failed) return <div className="phaser-error" role="alert">{this.props.message}</div>
    return this.props.children
  }
}
