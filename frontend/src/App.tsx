import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Jobs } from './pages/Jobs';
import { JobDetail } from './pages/JobDetail';
import { FitAnalysis } from './pages/FitAnalysis';
import { RankedJobs } from './pages/RankedJobs';
import { ApplicationAssistant } from './pages/ApplicationAssistant';
import { SavedJobs } from './pages/SavedJobs';
import { Applications } from './pages/Applications';
import { Pipeline } from './pages/Pipeline';
import { PipelineHealth } from './pages/PipelineHealth';
import { RetentionStats } from './pages/RetentionStats';
import { Resume } from './pages/Resume';
import { Profile } from './pages/Profile';
import { Preferences } from './pages/Preferences';
import { Search } from './pages/Search';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { PublicDashboard } from './pages/PublicDashboard';
import { PublicJobs } from './pages/PublicJobs';
import { PublicRankedJobs } from './pages/PublicRankedJobs';
import { PublicApplications } from './pages/PublicApplications';
import { PublicJobDetail } from './pages/PublicJobDetail';
import { PublicFitAnalysis } from './pages/PublicFitAnalysis';
import { PublicPipeline } from './pages/PublicPipeline';
import { PublicRetention } from './pages/PublicRetention';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { PublicRoute } from './components/auth/PublicRoute';
import { AdminRoute } from './components/auth/AdminRoute';
import { JobSourcesPage } from './pages/admin/JobSources';
import { SystemUsersPage } from './pages/admin/SystemUsers';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Public demo routes — no auth required, read-only */}
            <Route element={<PublicRoute />}>
              <Route path="/demo" element={<Navigate to="/demo/dashboard" replace />} />
              <Route element={<Layout />}>
                <Route path="/demo/dashboard" element={<PublicDashboard />} />
                <Route path="/demo/jobs" element={<PublicJobs />} />
                <Route path="/demo/jobs/:stable_id" element={<PublicJobDetail />} />
                <Route path="/demo/jobs/:stable_id/fit" element={<PublicFitAnalysis />} />
                <Route path="/demo/ranked" element={<PublicRankedJobs />} />
                <Route path="/demo/applications" element={<PublicApplications />} />
                <Route path="/demo/pipeline" element={<PublicPipeline />} />
                <Route path="/demo/retention" element={<PublicRetention />} />
              </Route>
            </Route>

            {/* Protected routes — pathless Layout keeps the shell on every page,
                while children use absolute paths to match the nav targets. */}
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/jobs" element={<Jobs />} />
                <Route path="/jobs/:stable_id" element={<JobDetail />} />
                <Route path="/jobs/:stable_id/fit" element={<FitAnalysis />} />
                <Route path="/ranked" element={<RankedJobs />} />
                <Route path="/assistant" element={<ApplicationAssistant />} />
                <Route path="/saved-jobs" element={<SavedJobs />} />
                <Route path="/applications" element={<Applications />} />
                <Route path="/pipeline" element={<Pipeline />} />
                <Route path="/health" element={<PipelineHealth />} />
                <Route path="/retention" element={<RetentionStats />} />
                <Route path="/resume" element={<Resume />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/preferences" element={<Preferences />} />
                <Route path="/search" element={<Search />} />
              </Route>
            </Route>

            {/* Admin routes */}
            <Route element={<AdminRoute />}>
              <Route element={<Layout />}>
                <Route path="/admin/sources" element={<JobSourcesPage />} />
                <Route path="/admin/users" element={<SystemUsersPage />} />
              </Route>
            </Route>

            {/* Redirect root to login if not authenticated, otherwise dashboard */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;