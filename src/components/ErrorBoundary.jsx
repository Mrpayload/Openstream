import { Component } from "react";
import { AlertTriangle } from "lucide-react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn(`[ErrorBoundary] ${this.props.fallback || "Section"} crashed:`, error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="media-section fade-in">
          <div className="section-heading">
            <h2>{this.props.fallback || "Section unavailable"}</h2>
            <AlertTriangle size={16} />
          </div>
          <div className="error-boundary-fallback">
            <p>Something went wrong loading this section.</p>
            <button className="ghost-btn" onClick={() => this.setState({ hasError: false })}>
              Try again
            </button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
