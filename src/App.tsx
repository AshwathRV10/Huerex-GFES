import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useStore } from './lib/store'
import { Button, Callout } from './components/ui'

import Dashboard from './pages/Dashboard'
import Alerts from './pages/Alerts'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Costing from './pages/Costing'
import CostingDetail from './pages/CostingDetail'
import RateBook from './pages/RateBook'
import Buyers from './pages/Buyers'
import Fabric from './pages/Fabric'
import Trims from './pages/Trims'
import Cutting from './pages/Cutting'
import Fusing from './pages/Fusing'
import JobWork from './pages/JobWork'
import Sewing from './pages/Sewing'
import Checking from './pages/Checking'
import Packing from './pages/Packing'
import Inspection from './pages/Inspection'
import Shipment from './pages/Shipment'
import Wip from './pages/Wip'
import Reconciliation from './pages/Reconciliation'
import Timeline from './pages/Timeline'
import SetControl from './pages/SetControl'
import Approvals from './pages/Approvals'
import Masters from './pages/Masters'
import SettingsPage from './pages/Settings'
import SignIn, { AuthLoading, ChangePasswordGate } from './pages/SignIn'
import People from './pages/People'
import AuditLogPage from './pages/AuditLog'
import { RequirePermission } from './components/Gate'

export default function App() {
  const ready = useStore((s) => s.ready)
  const error = useStore((s) => s.error)
  const authChecked = useStore((s) => s.authChecked)
  const signedIn = useStore((s) => s.signedIn)
  const mustChangePassword = useStore((s) => s.mustChangePassword)
  const checkAuth = useStore((s) => s.checkAuth)
  const load = useStore((s) => s.load)

  useEffect(() => { checkAuth() }, [checkAuth])

  // Until the session is resolved, showing either the app or the login form
  // would be a guess — so neither is shown.
  if (!authChecked) return <AuthLoading />
  if (!signedIn) return <SignIn />
  if (mustChangePassword) return <ChangePasswordGate />
  if (!ready) return <Splash />

  if (error) {
    return (
      <div className="h-full grid place-items-center p-6 bg-canvas">
        <div className="max-w-md w-full space-y-4">
          <Callout tone="risk" title="Could not load the factory data">
            {error}
            <p className="mt-2 text-ink-3">
              Start the server with <code className="px-1 rounded bg-sunken">npm run dev</code> and reload.
            </p>
          </Callout>
          <Button variant="primary" onClick={() => load()}>Try again</Button>
        </div>
      </div>
    )
  }

  return (
    <AppShell>
      <ScreenBoundary>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/alerts" element={<Alerts />} />

          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:orderNo" element={<OrderDetail />} />
          <Route
            path="/costing"
            element={<RequirePermission permission="costing.view" what="Costing"><Costing /></RequirePermission>}
          />
          <Route
            path="/costing/:orderNo"
            element={<RequirePermission permission="costing.view" what="Costing"><CostingDetail /></RequirePermission>}
          />
          <Route
            path="/rates"
            element={<RequirePermission permission="costing.view" what="The rate book"><RateBook /></RequirePermission>}
          />
          <Route path="/buyers" element={<Buyers />} />

          <Route path="/fabric" element={<Fabric />} />
          <Route path="/trims" element={<Trims />} />

          <Route path="/cutting" element={<Cutting />} />
          <Route path="/fusing" element={<Fusing />} />
          <Route path="/job-work" element={<JobWork />} />
          <Route path="/sewing" element={<Sewing />} />
          <Route path="/checking" element={<Checking />} />
          <Route path="/packing" element={<Packing />} />
          <Route path="/inspection" element={<Inspection />} />
          <Route path="/shipment" element={<Shipment />} />

          <Route path="/wip" element={<Wip />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/sets" element={<SetControl />} />

          <Route path="/approvals" element={<Approvals />} />
          <Route path="/masters" element={<Masters />} />
          <Route path="/people" element={<People />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route
            path="/settings"
            element={<RequirePermission permission="admin.settings" what="Settings"><SettingsPage /></RequirePermission>}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ScreenBoundary>
    </AppShell>
  )
}

/**
 * One boundary around whichever screen is showing, reset by the route — so a
 * screen that fails does not follow the user to the next one.
 */
function ScreenBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
}

function Splash() {
  return (
    <div className="h-full grid place-items-center bg-canvas grain">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="size-11 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center shadow-lift">
          <span className="size-5 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
        </div>
        <p className="text-sm text-ink-3">Loading the factory…</p>
      </div>
    </div>
  )
}
