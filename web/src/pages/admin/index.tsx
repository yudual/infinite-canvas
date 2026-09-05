import { useState } from "react";
import { Tabs, Button, theme, Typography } from "antd";
import { Link } from "react-router-dom";
import {
    LayoutDashboard,
    Users as UsersIcon,
    Cpu,
    Image as ImageIcon,
    FolderKanban,
    FileText,
    ArrowLeft,
    ShieldCheck,
    Megaphone,
} from "lucide-react";
import { useAdminData } from "./hooks/use-admin-data";
import { AdminOverviewCard } from "./components/admin-overview-card";
import { AdminChannelsPanel } from "./components/admin-channels-panel";
import { AdminUserTable } from "./components/admin-user-table";
import { AdminAssetsPanel } from "./components/admin-assets-panel";
import { AdminProjectsPanel } from "./components/admin-projects-panel";
import { AdminAuditLogsPanel } from "./components/admin-audit-logs-panel";
import { AdminNoticePanel } from "./components/admin-notice-panel";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useUserStore } from "@/stores/use-user-store";

const { Title, Paragraph } = Typography;

export default function AdminPage() {
    const { token } = theme.useToken();
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
                    onSwitchTab={setActiveTab}
                />
            ),
        },
        {
            key: "channels",
            label: (
                <span className="flex items-center gap-1.5">
                    <Cpu className="size-4" />
                    AI 模型渠道
                </span>
            ),
            children: <AdminChannelsPanel />,
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
            key: "assets",
            label: (
                <span className="flex items-center gap-1.5">
                    <ImageIcon className="size-4" />
                    素材库管理
                </span>
            ),
            children: <AdminAssetsPanel />,
        },
        {
            key: "projects",
            label: (
                <span className="flex items-center gap-1.5">
                    <FolderKanban className="size-4" />
                    云端工程
                </span>
            ),
            children: <AdminProjectsPanel />,
        },
        {
            key: "audit-logs",
            label: (
                <span className="flex items-center gap-1.5">
                    <FileText className="size-4" />
                    调用审计日志
                </span>
            ),
            children: <AdminAuditLogsPanel />,
        },
        {
            key: "notice",
            label: (
                <span className="flex items-center gap-1.5">
                    <Megaphone className="size-4" />
                    系统公告设置
                </span>
            ),
            children: <AdminNoticePanel />,
        },
    ];


    return (
        <div
            className="flex h-screen flex-col overflow-hidden"
            style={{ backgroundColor: token.colorBgLayout, color: token.colorText }}
        >
            {/* Top Navigation Bar */}
            <header
                className="sticky top-0 z-20 h-14 shrink-0 border-b backdrop-blur-xl"
                style={{
                    backgroundColor: token.colorBgContainer,
                    borderColor: token.colorBorderSecondary,
                }}
            >
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
                            <span className="text-base font-semibold tracking-tight hidden sm:inline">Yu-canvas</span>
                            <span
                                className="inline-flex items-center gap-1 rounded-md px-1.5 sm:px-2 py-0.5 text-xs font-medium"
                                style={{
                                    backgroundColor: token.colorPrimaryBg,
                                    color: token.colorPrimaryText,
                                }}
                            >
                                <ShieldCheck className="size-3.5" />
                                <span>管理控制台</span>
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-3">
                        <Link to="/">
                            <Button type="text" icon={<ArrowLeft className="size-4" />} size="middle">
                                <span className="hidden sm:inline">返回工作台</span>
                            </Button>
                        </Link>
                        <UserStatusActions showConfig={false} />
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl space-y-6">
                    <div
                        className="flex items-center justify-between border-b pb-4"
                        style={{ borderColor: token.colorBorderSecondary }}
                    >
                        <div>
                            <Title level={3} className="!mb-0" style={{ color: token.colorTextHeading }}>
                                系统后台管理
                            </Title>
                            <Paragraph type="secondary" className="!mb-0 mt-1 text-sm">
                                欢迎管理员 {currentUser?.displayName || currentUser?.username || "Admin"}，在此管理模型渠道池、素材与工程运维、查看调用审计与系统状态。
                            </Paragraph>
                        </div>
                        <div className="hidden items-center gap-2 text-xs text-secondary-foreground md:flex">
                            <span className="size-2 rounded-full bg-emerald-500" />
                            管理服务正常
                        </div>
                    </div>

                    <Tabs
                        activeKey={activeTab}
                        onChange={setActiveTab}
                        items={tabItems}
                        size="large"
                        tabBarGutter={20}
                        className="admin-tabs"
                    />
                </div>
            </main>
        </div>
    );
}
