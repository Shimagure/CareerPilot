import { DemoSidebar } from "./demo-sidebar"
import { ErrorBoundary } from "@/components/error-boundary"
import { SidebarProvider } from "@/contexts/sidebar-context"
import { DemoAppShell } from "./demo-app-shell"

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-zinc-950 dark">
        <DemoSidebar />
        <DemoAppShell>
          <ErrorBoundary>{children}</ErrorBoundary>
        </DemoAppShell>
      </div>
    </SidebarProvider>
  )
}