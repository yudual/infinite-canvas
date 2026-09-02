import type { ReactNode } from "react";
import { useEffect } from "react";
import { Spin } from "antd";
import { createBrowserRouter, Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AdminPage from "@/pages/admin";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import SetupPage from "@/pages/setup";
import VideoPage from "@/pages/video";
import { useUserStore } from "@/stores/use-user-store";

function LoadingFallback() {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
            <Spin size="large" />
        </div>
    );
}

export function AuthGuard({ children, requireAdmin = false }: { children: ReactNode; requireAdmin?: boolean }) {
    const { token, user, requiresSetup, loading, checkSetupAndAuth } = useUserStore();
    const location = useLocation();

    useEffect(() => {
        void checkSetupAndAuth();
    }, [checkSetupAndAuth]);

    if (loading) {
        return <LoadingFallback />;
    }

    if (requiresSetup) {
        return <Navigate to="/setup" replace />;
    }

    if (!token || !user) {
        const from = encodeURIComponent(location.pathname + location.search);
        return <Navigate to={`/login?from=${from}`} replace />;
    }

    if (requireAdmin && user.role !== "admin") {
        return <Navigate to="/" replace />;
    }

    return <>{children}</>;
}

export function SetupGuard({ children }: { children: ReactNode }) {
    const { requiresSetup, loading, checkSetupAndAuth } = useUserStore();

    useEffect(() => {
        void checkSetupAndAuth();
    }, [checkSetupAndAuth]);

    if (loading) {
        return <LoadingFallback />;
    }

    if (requiresSetup === false) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}

export function LoginGuard({ children }: { children: ReactNode }) {
    const { token, user, requiresSetup, loading, checkSetupAndAuth } = useUserStore();
    const [searchParams] = useSearchParams();

    useEffect(() => {
        void checkSetupAndAuth();
    }, [checkSetupAndAuth]);

    if (loading) {
        return <LoadingFallback />;
    }

    if (requiresSetup) {
        return <Navigate to="/setup" replace />;
    }

    if (token && user) {
        const from = searchParams.get("from") || "/";
        return <Navigate to={from} replace />;
    }

    return <>{children}</>;
}

export const router = createBrowserRouter([
    {
        path: "/setup",
        element: (
            <SetupGuard>
                <SetupPage />
            </SetupGuard>
        ),
    },
    {
        path: "/login",
        element: (
            <LoginGuard>
                <LoginPage />
            </LoginGuard>
        ),
    },
    {
        element: (
            <AuthGuard>
                <UserLayout>
                    <AnalyticsTracker />
                    <Outlet />
                </UserLayout>
            </AuthGuard>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    {
        path: "/admin",
        element: (
            <AuthGuard requireAdmin>
                <AdminPage />
            </AuthGuard>
        ),
    },
    { path: "*", element: <NotFound /> },
]);
