import { useState, useEffect, useCallback } from "react";
import { Table, Button, Popconfirm, Space, Typography, message, Input } from "antd";
import { Trash2, RotateCw, RefreshCcw, FolderKanban } from "lucide-react";
import type { AdminProjectItem } from "@/services/api/admin";
import {
    getAdminProjects,
    deleteAdminProject,
    batchDeleteAdminProjects,
    resetAdminProject,
} from "@/services/api/admin";
import { formatBytes } from "@/lib/image-utils";

const { Text } = Typography;

export function AdminProjectsPanel() {
    const [projects, setProjects] = useState<AdminProjectItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [search, setSearch] = useState("");
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [batchDeleting, setBatchDeleting] = useState(false);

    const loadProjects = useCallback(async (p = page, l = limit, s = search) => {
        try {
            setLoading(true);
            const res = await getAdminProjects({ page: p, limit: l, search: s.trim() || undefined });
            setProjects(res.projects || []);
            setTotal(res.total || 0);
        } catch (err: any) {
            message.error(err.response?.data?.message || "获取工程列表失败");
        } finally {
            setLoading(false);
        }
    }, [page, limit, search]);

    useEffect(() => {
        void loadProjects(1, limit, "");
    }, [loadProjects, limit]);

    const handleDeleteSingle = async (id: string) => {
        try {
            await deleteAdminProject(id);
            message.success("工程删除成功");
            void loadProjects(page, limit, search);
        } catch (err: any) {
            message.error(err.response?.data?.message || "删除工程失败");
        }
    };

    const handleResetSingle = async (id: string) => {
        try {
            await resetAdminProject(id);
            message.success("画布工程已重置为空白健康状态");
            void loadProjects(page, limit, search);
        } catch (err: any) {
            message.error(err.response?.data?.message || "重置工程失败");
        }
    };

    const handleBatchDelete = async () => {
        if (selectedRowKeys.length === 0) return;
        try {
            setBatchDeleting(true);
            const res = await batchDeleteAdminProjects(selectedRowKeys as string[]);
            message.success(`成功删除 ${res.deletedCount} 个工程`);
            setSelectedRowKeys([]);
            void loadProjects(page, limit, search);
        } catch (err: any) {
            message.error(err.response?.data?.message || "批量删除失败");
        } finally {
            setBatchDeleting(false);
        }
    };

    const columns = [
        {
            title: "工程名称",
            key: "name",
            render: (_: any, record: AdminProjectItem) => (
                <Space direction="vertical" size={2}>
                    <Text strong>{record.name}</Text>
                    {record.description && (
                        <Text type="secondary" className="text-xs">
                            {record.description}
                        </Text>
                    )}
                </Space>
            ),
        },
        {
            title: "所属用户",
            key: "user",
            width: 160,
            render: (_: any, record: AdminProjectItem) => (
                <Text>{record.userDisplayName || record.username || "未知用户"}</Text>
            ),
        },
        {
            title: "数据体积",
            key: "canvasDataSize",
            width: 120,
            render: (_: any, record: AdminProjectItem) => (
                <Text>{formatBytes(record.canvasDataSize)}</Text>
            ),
        },
        {
            title: "更新时间",
            key: "updatedAt",
            width: 180,
            render: (_: any, record: AdminProjectItem) => (
                <Text type="secondary" className="text-xs">
                    {new Date(record.updatedAt).toLocaleString()}
                </Text>
            ),
        },
        {
            title: "操作",
            key: "actions",
            width: 140,
            render: (_: any, record: AdminProjectItem) => (
                <Space size="small">
                    <Popconfirm
                        title="确认重置该工程画布？"
                        description="当画布数据受损无法加载时，可重置为空白健康节点树。"
                        okText="重置"
                        cancelText="取消"
                        onConfirm={() => handleResetSingle(record.id)}
                    >
                        <Button size="small" icon={<RefreshCcw className="size-3.5" />}>
                            重置
                        </Button>
                    </Popconfirm>

                    <Popconfirm
                        title="确认彻底删除该工程？"
                        description="删除后用户将无法找回此云端工程。"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => handleDeleteSingle(record.id)}
                    >
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center gap-2 sm:max-w-md">
                    <Input.Search
                        placeholder="搜索工程名称..."
                        defaultValue={search}
                        onSearch={(val) => {
                            setSearch(val);
                            setPage(1);
                            void loadProjects(1, limit, val);
                        }}
                        allowClear
                    />
                    <Button
                        icon={<RotateCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
                        onClick={() => void loadProjects(page, limit, search)}
                        disabled={loading}
                    />
                </div>

                {selectedRowKeys.length > 0 && (
                    <Popconfirm
                        title={`确认批量删除选中的 ${selectedRowKeys.length} 个工程？`}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={handleBatchDelete}
                    >
                        <Button danger loading={batchDeleting} icon={<Trash2 className="size-4" />}>
                            批量删除 ({selectedRowKeys.length})
                        </Button>
                    </Popconfirm>
                )}
            </div>

            <Table
                rowKey="id"
                rowSelection={{
                    selectedRowKeys,
                    onChange: setSelectedRowKeys,
                }}
                columns={columns}
                dataSource={projects}
                loading={loading}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 个工程`,
                    onChange: (p, l) => {
                        setPage(p);
                        setLimit(l);
                        void loadProjects(p, l, search);
                    },
                }}
                scroll={{ x: "max-content" }}
            />
        </div>
    );
}
