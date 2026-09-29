import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import StockRoom from './pages/StockRoom'
import VendorLists from './pages/VendorLists'
import Groups from './pages/Groups'
import Chat from './pages/Chat'
import Tools from './pages/Tools'
import Events from './pages/Events'
import POSBridge from './pages/POSBridge'
import VendorProfile from './pages/VendorProfile'

function RequireVendor({ children }) {
  const { isAuthenticated } = useAuth()
  const loc = useLocation()
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return children
}

function PublicOnly({ children }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Navigate to="/" replace /> : children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
        <Route element={<RequireVendor><Layout /></RequireVendor>}>
          <Route index element={<Dashboard />} />
          <Route path="stock" element={<StockRoom />} />
          <Route path="vendor-lists" element={<VendorLists />} />
          <Route path="groups" element={<Groups />} />
          <Route path="chat" element={<Chat />} />
          <Route path="tools" element={<Tools />} />
          <Route path="events" element={<Events />} />
          <Route path="pos" element={<POSBridge />} />
          <Route path=":handle" element={<VendorProfile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
