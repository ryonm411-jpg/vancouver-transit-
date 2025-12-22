import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
    userId: string | null;
    setUserId: (id: string | null) => void;
}

const AuthContext = createContext<AuthContextType>({
    userId: null,
    setUserId: () => { },
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    // For now, use a demo user ID
    // TODO: Replace with actual Firebase Authentication
    const [userId, setUserId] = useState<string | null>('demo-user');

    return (
        <AuthContext.Provider value={{ userId, setUserId }}>
            {children}
        </AuthContext.Provider>
    );
}
