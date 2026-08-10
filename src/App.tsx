import { useState } from 'react';
import Login, { type LoginPayload } from './Login';
import DashboardLayout from './DashboardLayout';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false); 
  const [userRole, setUserRole] = useState('Admin');

  // Yeh function payload receive karega aur role ko format karega
  const handleLoginSuccess = (payload: LoginPayload) => {
    const formattedRole = payload.role === 'admin' 
      ? 'Admin' 
      : payload.role === 'fleet-manager' 
        ? 'Fleet Manager' 
        : 'Driver';

    setUserRole(formattedRole);
    setIsLoggedIn(true);
  };

  return (
    <div className="w-full min-h-screen bg-[#0b0f1a] text-white">
      {!isLoggedIn ? (
        // Humne onLoginSuccess ko badal kar exact onLogin kar diya hai
        <Login onLogin={handleLoginSuccess} />
      ) : (
        <DashboardLayout role={userRole} onLogout={() => setIsLoggedIn(false)} />
      )}
    </div>
  );
}
