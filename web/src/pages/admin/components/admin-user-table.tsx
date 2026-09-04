import { useState } from "react";
import { Table, Input, Button, Tag, Space, Popconfirm, Modal, Form, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Search, UserPlus, RotateCw, KeyRound, Trash2, CheckCircle2, XCircle } from "lucide-react";
import type { AdminUserItem, CreateUserPayload } from "@/services/api/admin";
import { AdminUserModal } from "./admin-user-modal";
import { useUserStore } from "@/stores/use-user-store";

type AdminUserTableProps = {
    users: AdminUserItem[];
    total: number;
    loading: boolean;
    page: number;
    limit: number;
    search: string;
    onPageChange: (page: number, limit: number) => void;
    onSearch: (value: string) => void;
    onRefresh: () => void;
    onCreateUser: (payload: CreateUserPayload) => Promise<boolean>;
    onToggleStatus: (id: string, nextStatus: "active" | "disabled") => Promise<boolean>;
    onResetPassword: (id: string, newPassword: string) => Promise<boolean>;
    onDeleteUser: (id: string) => Promise<boolean>;
};

export function AdminUserTable({
    users,
    total,
    loading,
    page,
    limit,
    search,
    onPageChange,
    onSearch,
    onRefresh,
    onCreateUser,
    onToggleStatus,
    onResetPassword,
    onDeleteUser,
}: AdminUserTableProps) {
    const currentUser = useUserStore((state) => state.user);
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [resetTargetUser, setResetTargetUser] = useState<AdminUserItem | null>(null);
    const [resetSubmitting, setResetSubmitting] = useState(false);
    const [resetForm] = Form.useForm();

    const handleConfirmReset = async () => {
        if (!resetTargetUser) return;
        try {
            const values = await resetForm.validateFields();
            setResetSubmitting(true);
            const success = await onResetPassword(resetTargetUser.id, values.newPassword);
            if (success) {
                resetForm.resetFields();
                setResetTargetUser(null);
            }
        } catch {
            // Validation failed
        } finally {
            setResetSubmitting(false);
        }
    };

    const columns: ColumnsType<AdminUserItem> = [
        {
            title: "用户名",
            dataIndex: "username",
            key: "username",
            render: (username: string, record) => (
                <div className="flex flex-col">
                    <span className="font-medium text-stone-950 dark:text-stone-100">
                        {username}
                        {currentUser?.id === record.id && (
                            <Tag color="blue" className="ml-2">当前账号</Tag>
                        )}
                    </span>
                    {record.displayName && (
                        <span className="text-xs text-stone-400">{record.displayName}</span>
                    )}
                </div>
            ),
        },
        {
            title: "角色权限",
            dataIndex: "role",
            key: "role",
            width: 120,
            render: (role: "admin" | "user") =>
                role === "admin" ? (
                    <Tag color="purple">管理员</Tag>
                ) : (
                    <Tag color="default">普通用户</Tag>
                ),
        },
        {
            title: "账号状态",
            dataIndex: "status",
            key: "status",
            width: 120,
            render: (status: "active" | "disabled") =>
                status === "active" ? (
                    <Tag icon={<CheckCircle2 className="size-3 mr-1 inline" />} color="success">正常</Tag>
                ) : (
                    <Tag icon={<XCircle className="size-3 mr-1 inline" />} color="error">已禁用</Tag>
                ),
        },
        {
            title: "注册时间",
            dataIndex: "createdAt",
            key: "createdAt",
            width: 180,
            render: (dateStr: string) => (
                <span className="text-xs text-stone-500 dark:text-stone-400">
                    {dateStr ? new Date(dateStr).toLocaleString("zh-CN") : "-"}
                </span>
            ),
        },
        {
            title: "操作",
            key: "action",
            width: 260,
            render: (_, record) => {
                const isSelf = currentUser?.id === record.id;
                const nextStatus = record.status === "active" ? "disabled" : "active";

                return (
                    <Space size="small">
                        <Popconfirm
                            title={record.status === "active" ? "确认禁用此账号？" : "确认重新启用此账号？"}
                            description={
                                record.status === "active"
                                    ? "禁用后该用户将无法登录系统或使用 API"
                                    : "启用后该用户恢复系统登录及 API 使用权限"
                            }
                            okText="确定"
                            cancelText="取消"
                            onConfirm={() => void onToggleStatus(record.id, nextStatus)}
                            disabled={isSelf}
                        >
                            <Button
                                type="link"
                                size="small"
                                danger={record.status === "active"}
                                disabled={isSelf}
                            >
                                {record.status === "active" ? "禁用" : "启用"}
                            </Button>
                        </Popconfirm>

                        <Button
                            type="link"
                            size="small"
                            icon={<KeyRound className="size-3.5" />}
                            onClick={() => setResetTargetUser(record)}
                        >
                            重置密码
                        </Button>

                        <Popconfirm
                            title="确定要永久删除该用户吗？"
                            description="删除后该用户及其创建的数据将被级联清理，且无法恢复。"
                            okText="确定删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => void onDeleteUser(record.id)}
                            disabled={isSelf}
                        >
                            <Tooltip title={isSelf ? "不可删除当前登录的管理员账号" : undefined}>
                                <Button
                                    type="link"
                                    size="small"
                                    danger
                                    icon={<Trash2 className="size-3.5" />}
                                    disabled={isSelf}
                                >
                                    删除
                                </Button>
                            </Tooltip>
                        </Popconfirm>
                    </Space>
                );
            },
        },
    ];

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center gap-2 sm:max-w-md">
                    <Input.Search
                        placeholder="搜索用户名或昵称..."
                        defaultValue={search}
                        onSearch={(val) => onSearch(val)}
                        allowClear
                    />
                    <Button
                        icon={<RotateCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
                        onClick={onRefresh}
                        disabled={loading}
                    />
                </div>
                <Button
                    type="primary"
                    icon={<UserPlus className="size-4" />}
                    onClick={() => setCreateModalOpen(true)}
                >
                    新增用户
                </Button>
            </div>

            <Table
                rowKey="id"
                columns={columns}
                dataSource={users}
                loading={loading}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total,
                    showSizeChanger: true,
                    pageSizeOptions: ["10", "20", "50"],
                    showTotal: (t) => `共 ${t} 位用户`,
                    onChange: (p, l) => onPageChange(p, l),
                }}
                className="border border-stone-200/80 rounded-lg overflow-hidden dark:border-stone-800"
                size="middle"
                scroll={{ x: "max-content" }}
            />

            <AdminUserModal
                open={createModalOpen}
                onCancel={() => setCreateModalOpen(false)}
                onSubmit={onCreateUser}
            />

            <Modal
                title={`重置密码 - ${resetTargetUser?.username || ""}`}
                open={Boolean(resetTargetUser)}
                onCancel={() => {
                    resetForm.resetFields();
                    setResetTargetUser(null);
                }}
                onOk={handleConfirmReset}
                confirmLoading={resetSubmitting}
                okText="确认重置"
                cancelText="取消"
                destroyOnClose
            >
                <Form form={resetForm} layout="vertical" requiredMark={false} className="mt-4">
                    <Form.Item
                        name="newPassword"
                        label="新登录密码"
                        rules={[
                            { required: true, message: "请输入新密码" },
                            { min: 6, message: "密码长度不能少于 6 位" },
                        ]}
                    >
                        <Input.Password placeholder="至少 6 位字符" autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item
                        name="confirmPassword"
                        label="确认新密码"
                        dependencies={["newPassword"]}
                        rules={[
                            { required: true, message: "请再次输入新密码" },
                            ({ getFieldValue }) => ({
                                validator(_, value) {
                                    if (!value || getFieldValue("newPassword") === value) {
                                        return Promise.resolve();
                                    }
                                    return Promise.reject(new Error("两次输入的密码不一致"));
                                },
                            }),
                        ]}
                    >
                        <Input.Password placeholder="再次输入新密码确认" autoComplete="new-password" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
