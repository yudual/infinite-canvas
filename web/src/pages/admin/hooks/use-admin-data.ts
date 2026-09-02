import { useState, useCallback, useEffect } from "react";
import { App } from "antd";
import {
    getAdminStats,
    getAdminUsers,
    createAdminUser,
    updateAdminUserStatus,
    resetAdminUserPassword,
    deleteAdminUser,
    getAdminAiConfig,
    updateAdminAiConfig,
    testAdminAiConfig,
    type SystemStats,
    type AdminUserItem,
    type AiConfig,
    type CreateUserPayload,
    type UpdateAiConfigPayload,
    type TestAiConfigPayload,
    type TestAiConfigResponse,
} from "@/services/api/admin";

export function useAdminData() {
    const { message } = App.useApp();

    // Stats State
    const [stats, setStats] = useState<SystemStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(false);

    // Users State
    const [users, setUsers] = useState<AdminUserItem[]>([]);
    const [usersTotal, setUsersTotal] = useState(0);
    const [usersLoading, setUsersLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [search, setSearch] = useState("");

    // AI Config State
    const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
    const [aiConfigLoading, setAiConfigLoading] = useState(false);
    const [aiConfigSaving, setAiConfigSaving] = useState(false);
    const [aiTestLoading, setAiTestLoading] = useState(false);
    const [aiTestResult, setAiTestResult] = useState<TestAiConfigResponse | null>(null);

    // Fetch Stats
    const loadStats = useCallback(async () => {
        try {
            setStatsLoading(true);
            const data = await getAdminStats();
            setStats(data);
        } catch (error: any) {
            const msg = error.response?.data?.message || error.message || "获取系统统计失败";
            message.error(msg);
        } finally {
            setStatsLoading(false);
        }
    }, [message]);

    // Fetch Users
    const loadUsers = useCallback(async (targetPage = page, targetLimit = limit, targetSearch = search) => {
        try {
            setUsersLoading(true);
            const data = await getAdminUsers({
                page: targetPage,
                limit: targetLimit,
                search: targetSearch.trim() || undefined,
            });
            setUsers(data.users);
            setUsersTotal(data.total);
        } catch (error: any) {
            const msg = error.response?.data?.message || error.message || "获取用户列表失败";
            message.error(msg);
        } finally {
            setUsersLoading(false);
        }
    }, [page, limit, search, message]);

    // Fetch AI Config
    const loadAiConfig = useCallback(async () => {
        try {
            setAiConfigLoading(true);
            const data = await getAdminAiConfig();
            setAiConfig(data);
        } catch (error: any) {
            const msg = error.response?.data?.message || error.message || "获取 AI 模型配置失败";
            message.error(msg);
        } finally {
            setAiConfigLoading(false);
        }
    }, [message]);

    // Actions
    const handleCreateUser = async (payload: CreateUserPayload): Promise<boolean> => {
        try {
            await createAdminUser(payload);
            message.success("用户创建成功");
            await loadUsers(1, limit, search);
            void loadStats();
            return true;
        } catch (error: any) {
            const msg = error.response?.data?.message || error.response?.data?.error?.message || error.message || "创建用户失败";
            message.error(msg);
            return false;
        }
    };

    const handleToggleUserStatus = async (id: string, nextStatus: "active" | "disabled"): Promise<boolean> => {
        try {
            await updateAdminUserStatus(id, { status: nextStatus });
            message.success(`用户已${nextStatus === "active" ? "启用" : "禁用"}`);
            setUsers((prev) =>
                prev.map((u) => (u.id === id ? { ...u, status: nextStatus } : u))
            );
            void loadStats();
            return true;
        } catch (error: any) {
            const msg = error.response?.data?.message || error.response?.data?.error?.message || error.message || "修改用户状态失败";
            message.error(msg);
            return false;
        }
    };

    const handleResetPassword = async (id: string, newPassword: string): Promise<boolean> => {
        try {
            await resetAdminUserPassword(id, { newPassword });
            message.success("密码重置成功");
            return true;
        } catch (error: any) {
            const msg = error.response?.data?.message || error.response?.data?.error?.message || error.message || "重置密码失败";
            message.error(msg);
            return false;
        }
    };

    const handleDeleteUser = async (id: string): Promise<boolean> => {
        try {
            await deleteAdminUser(id);
            message.success("用户删除成功");
            await loadUsers(page, limit, search);
            void loadStats();
            return true;
        } catch (error: any) {
            const msg = error.response?.data?.message || error.response?.data?.error?.message || error.message || "删除用户失败";
            message.error(msg);
            return false;
        }
    };

    const handleSaveAiConfig = async (payload: UpdateAiConfigPayload): Promise<boolean> => {
        try {
            setAiConfigSaving(true);
            await updateAdminAiConfig(payload);
            message.success("AI 模型配置保存成功");
            await loadAiConfig();
            return true;
        } catch (error: any) {
            const msg = error.response?.data?.message || error.response?.data?.error?.message || error.message || "保存 AI 配置失败";
            message.error(msg);
            return false;
        } finally {
            setAiConfigSaving(false);
        }
    };

    const handleTestAiConfig = async (payload: TestAiConfigPayload): Promise<TestAiConfigResponse | null> => {
        try {
            setAiTestLoading(true);
            setAiTestResult(null);
            const res = await testAdminAiConfig(payload);
            setAiTestResult(res);
            if (res.success) {
                message.success(`连通性测试通过${res.latencyMs !== undefined ? ` (耗时 ${res.latencyMs}ms)` : ""}`);
            } else {
                message.error(`连通性测试失败: ${res.message || "接口未响应"}`);
            }
            return res;
        } catch (error: any) {
            const msg = error.response?.data?.message || error.response?.data?.error?.message || error.message || "连通性测试请求失败";
            const failResult = { success: false, message: msg };
            setAiTestResult(failResult);
            message.error(msg);
            return failResult;
        } finally {
            setAiTestLoading(false);
        }
    };

    useEffect(() => {
        void loadStats();
        void loadUsers(1, limit, "");
        void loadAiConfig();
    }, [loadStats, loadUsers, loadAiConfig, limit]);

    return {
        // Stats
        stats,
        statsLoading,
        loadStats,

        // Users
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

        // AI Config
        aiConfig,
        aiConfigLoading,
        aiConfigSaving,
        aiTestLoading,
        aiTestResult,
        setAiTestResult,
        loadAiConfig,
        handleSaveAiConfig,
        handleTestAiConfig,
    };
}
