import { useState } from "react";
import { Tabs, Button } from "antd";
import { Link } from "react-router-dom";
import {
    LayoutDashboard,
    Users as UsersIcon,
    Sparkles,
    ArrowLeft,
    ShieldCheck,
} from "lucide-react";
import { useAdminData } from "./hooks/use-admin-data";
import { AdminOverviewCard } from "./components/admin-overview-card";
import { AdminUserTable } from "./components/admin-user-table";
import { AdminAiConfigPanel } from "./components/admin-ai-config-panel";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useUserStore } from "@/stores/use-user-store";

export default function AdminPage() {
    const currentUser = useUserStore((state) => state.user);
    const [activeTab, setActiveTab] = useState("overview");

    const {
        stats,
        statsLoading,
        loadStats,

        users,
        usersTotal,
        usersLoading,
        page,
        limit,
        search,
        setPage,
        setLimit,
        setSearch,
        loadUsers,
        handleCreateUser,
        handleToggleUserStatus,
        handleResetPassword,
        handleDeleteUser,

        aiConfig,
        aiConfigLoading,
        aiConfigSaving,
        aiTestLoading,
        aiTestResult,
        setAiTestResult,
        loadAiConfig,
        handleSaveAiConfig,
        handleTestAiConfig,
    } = useAdminData();

    const tabItems = [
        {
            key: "overview",
            label: (
                <span className="flex items-center gap-1.5">
                    <LayoutDashboard className="size-4" />
                    系统概览
                </span>
            ),
            children: (
                <AdminOverviewCard
                    stats={stats}
                    loading={statsLoading}
                    onRefresh={loadStats}
                />
            ),
        },
        {
            key: "users",
            label: (
                <span className="flex items-center gap-1.5">
                    <UsersIcon className="size-4" />
                    用户管理
                </span>
            ),
            children: (
                <AdminUserTable
                    users={users}
                    total={usersTotal}
                    loading={usersLoading}
                    page={page}
                    limit={limit}
                    search={search}
                    onPageChange={(p, l) => {
                        setPage(p);
                        setLimit(l);
                        void loadUsers(p, l, search);
                    }}
                    onSearch={(val) => {
                        setSearch(val);
                        setPage(1);
                        void loadUsers(1, limit, val);
                    }}
                    onRefresh={() => void loadUsers(page, limit, search)}
                    onCreateUser={handleCreateUser}
                    onToggleStatus={handleToggleUserStatus}
                    onResetPassword={handleResetPassword}
                    onDeleteUser={handleDeleteUser}
                />
            ),
        },
        {
            key: "ai-config",
            label: (
                <span className="flex items-center gap-1.5">
                    <Sparkles className="size-4" />
                    AI 模型配置
                </span>
            ),
            children: (
                <AdminAiConfigPanel
                    aiConfig={aiConfig}
                    loading={aiConfigLoading}
                    saving={aiConfigSaving}
                    testLoading={aiTestLoading}
                    testResult={aiTestResult}
                    onSave={handleSaveAiConfig}
                    onTest={handleTestAiConfig}
                    onClearTestResult={() => setAiTestResult(null)}
                />
            ),
        },
    ];

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            {/* Top Navigation Bar */}
            <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-3">
                        <div
                            className="size-5 bg-current"
                            style={{
                                mask: "url(/logo.svg) center / contain no-repeat",
                                WebkitMask: "url(/logo.svg) center / contain no-repeat",
                            }}
                        />
                        <div className="flex items-center gap-2">
                            <span className="text-base font-semibold tracking-tight">Infinite Canvas</span>
                            <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                                <ShieldCheck className="size-3.5" />
                                管理控制台
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Link to="/">
                            <Button type="text" icon={<ArrowLeft className="size-4" />} size="middle">
                                返回工作台
                            </Button>
                        </Link>
                        <UserStatusActions showConfig={false} />
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-4 py-6 [background-size:16px_16px] sm:px-6 lg:px-8 dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
                <div className="mx-auto max-w-7xl space-y-6">
                    <div className="flex items-center justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-stone-950 dark:text-stone-100">
                                系统后台管理
                            </h1>
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                                欢迎管理员 {currentUser?.displayName || currentUser?.username || "Admin"}，在此管理用户、AI 服务及查看系统运行状态。
                            </p>
                        </div>
                    </div>

                    <Tabs
                        activeKey={activeTab}
                        onChange={setActiveTab}
                        items={tabItems}
                        size="large"
                        className="admin-dashboard-tabs"
                    />
                </div>
            </main>
        </div>
    );
}
