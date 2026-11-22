import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'Unknown UI error' };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-background p-6 text-center text-foreground">
          <div className="max-w-md rounded-xl border border-destructive/40 bg-card p-6">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold">Đã xảy ra lỗi giao diện</h2>
            <p className="mt-2 text-sm text-muted-foreground">{this.state.message}</p>
            <Button
              className="mt-4"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Tải lại ứng dụng
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
