import { Navigate, Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import Room from './pages/Room';
import SignIn from './pages/SignIn';
import Convert from './pages/Convert';
import Privacy from './pages/Privacy';
import { AuthProvider, useAuth } from './context/AuthContext';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">Loading…</main>;
  }
  return user ? children : <Navigate to="/signin" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Room />} />
        <Route path="/convert" element={<ProtectedRoute><Convert /></ProtectedRoute>} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
