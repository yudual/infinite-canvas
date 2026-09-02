import { create } from "zustand";
import { getMe, getSetupStatus, logout as apiLogout, type User } from "@/services/api/auth";

export type LocalUser = User;

type UserStore = {
    token: string | null;
    user: User | null;
    initialized: boolean | null;
    requiresSetup: boolean | null;
    loading: boolean;
    setSession: (token: string, user: User) => void;
    clearSession: () => void;
    logout: () => Promise<void>;
    setUser: (user: User | null) => void;
    checkSetupAndAuth: (force?: boolean) => Promise<{ requiresSetup: boolean; authenticated: boolean }>;
};

export const useUserStore = create<UserStore>()((set, get) => ({
    token: localStorage.getItem("token") || null,
    user: null,
    initialized: null,
    requiresSetup: null,
    loading: true,

    setSession: (token: string, user: User) => {
        localStorage.setItem("token", token);
        set({
            token,
            user,
            requiresSetup: false,
            initialized: true,
            loading: false,
        });
    },

    clearSession: () => {
        localStorage.removeItem("token");
        set({
            token: null,
            user: null,
            loading: false,
        });
    },

    logout: async () => {
        try {
            await apiLogout();
        } catch {}
        get().clearSession();
    },

    setUser: (user: User | null) => {
        set({ user });
    },

    checkSetupAndAuth: async (force = false) => {
        const state = get();
        if (!force && !state.loading && state.initialized !== null) {
            return {
                requiresSetup: Boolean(state.requiresSetup),
                authenticated: Boolean(state.token && state.user),
            };
        }

        try {
            set({ loading: true });
            const status = await getSetupStatus();

            if (status.requiresSetup) {
                localStorage.removeItem("token");
                set({
                    token: null,
                    user: null,
                    requiresSetup: true,
                    initialized: false,
                    loading: false,
                });
                return { requiresSetup: true, authenticated: false };
            }

            set({ requiresSetup: false, initialized: true });

            const currentToken = get().token || localStorage.getItem("token");
            if (!currentToken) {
                set({ user: null, loading: false });
                return { requiresSetup: false, authenticated: false };
            }

            try {
                const meRes = await getMe();
                set({ user: meRes.user, token: currentToken, loading: false });
                return { requiresSetup: false, authenticated: true };
            } catch {
                localStorage.removeItem("token");
                set({ token: null, user: null, loading: false });
                return { requiresSetup: false, authenticated: false };
            }
        } catch {
            set({ loading: false });
            return {
                requiresSetup: Boolean(get().requiresSetup),
                authenticated: false,
            };
        }
    },
}));
