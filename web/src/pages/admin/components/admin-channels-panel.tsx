import { useState, useEffect, useCallback } from "react";
import { Table, Button, Tag, Badge, Switch, Space, Popconfirm, message, Tooltip, Typography } from "antd";
import { Plus, RotateCw, Activity, Sparkles, Trash2, Edit2, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import type { AdminChannelItem, CreateChannelPayload, UpdateChannelPayload } from "@/services/api/admin";
import {
    getAdminChannels,
    createAdminChannel,
    updateAdminChannel,
    toggleAdminChannelStatus,
    deleteAdminChannel,
    testAdminChannel,
    syncAdminChannelModels,
} from "@/services/api/admin";
import { AdminChannelModal } from "./admin-channel-modal";

const { Text } = Typography;

export function AdminChannelsPanel() {
    const [channels, setChannels] = useState<AdminChannelItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [search, setSearch] = useState("");

    const [modalOpen, setModalOpen] = useState(false);
    const [editingChannel, setEditingChannel] = useState<AdminChannelItem | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [syncingId, setSyncingId] = useState<string | null>(null);

    const loadChannels = useCallback(async (p = page, l = limit, s = search) => {
        try {
            setLoading(true);
            const res = await getAdminChannels({ page: p, limit: l, search: s.trim() || undefined });
            setChannels(res.channels || []);
            setTotal(res.total || 0);
        } catch (err: any) {
            const msg = err.response?.data?.message || err.message || "获取渠道列表失败";
            message.error(msg);
        } finally {
            setLoading(false);
        }
    }, [page, limit, search]);

    useEffect(() => {
        void loadChannels(1, limit, "");
    }, [loadChannels, limit]);

    const handleToggleStatus = async (channel: AdminChannelItem, checked: boolean) => {
        try {
            await toggleAdminChannelStatus(channel.id, checked);
            message.success(`渠道 [${channel.name}] 已${checked ? "启用" : "停用"}`);
            setChannels((prev) =>
                prev.map((c) => (c.id === channel.id ? { ...c, isActive: checked } : c))
            );
        } catch (err: any) {
            message.error(err.response?.data?.message || "切换渠道状态失败");
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteAdminChannel(id);
            message.success("渠道删除成功");
            void loadChannels(page, limit, search);
        } catch (err: any) {
            message.error(err.response?.data?.message || "删除渠道失败");
        }
    };

    const handleTestConnectivity = async (channel: AdminChannelItem) => {
        try {
            setTestingId(channel.id);
            const res = await testAdminChannel(channel.id);
            if (res.success) {
                message.success(`[${channel.name}] 连通性测试正常，延迟 ${res.latencyMs}ms`);
            } else {
                message.warning(`[${channel.name}] 连通性异常：${res.message}`);
            }
            void loadChannels(page, limit, search);
        } catch (err: any) {
            message.error(err.response?.data?.message || "连通性测试请求失败");
        } finally {
            setTestingId(null);
        }
    };

    const handleSyncModels = async (channel: AdminChannelItem) => {
        try {
            setSyncingId(channel.id);
            const res = await syncAdminChannelModels(channel.id);
            if (res.success) {
                message.success(`已从 [${channel.name}] 同步更新 ${res.total} 个模型`);
                void loadChannels(page, limit, search);
            }
        } catch (err: any) {
            message.error(err.response?.data?.message || "模型同步失败");
        } finally {
            setSyncingId(null);
        }
    };

    const handleSaveChannel = async (payload: CreateChannelPayload | UpdateChannelPayload): Promise<boolean> => {
        try {
            if (editingChannel) {
                await updateAdminChannel(editingChannel.id, payload);
                message.success("渠道配置已更新");
            } else {
                await createAdminChannel(payload as CreateChannelPayload);
                message.success("新渠道创建成功");
            }
            void loadChannels(page, limit, search);
            return true;
        } catch (err: any) {
            message.error(err.response?.data?.message || "保存渠道失败");
            return false;
        }
    };

    const columns = [
        {
            title: "渠道名称",
            key: "name",
            render: (_: any, record: AdminChannelItem) => (
                <Space direction="vertical" size={2}>
                    <Space>
                        <Text strong>{record.name}</Text>
                        <Tag color="geekblue">{record.providerType}</Tag>
                    </Space>
                    <Text type="secondary" className="font-mono text-xs">
                        {record.baseUrl}
                    </Text>
                </Space>
            ),
        },
        {
            title: "绑定模型",
            key: "models",
            render: (_: any, record: AdminChannelItem) => {
                const count = record.models?.length || 0;
                if (count === 0) return <Text type="secondary">未绑定模型</Text>;
                return (
                    <Tooltip
                        title={
                            <div className="max-h-48 overflow-y-auto space-y-1">
                                {record.models.map((m) => (
                                    <div key={m} className="font-mono text-xs">{m}</div>
                                ))}
                            </div>
                        }
                    >
                        <Tag color="cyan" className="cursor-pointer">
                            {count} 个模型
                        </Tag>
                    </Tooltip>
                );
            },
        },
        {
            title: "调度优先级 / 权重",
            key: "priority",
            width: 140,
            render: (_: any, record: AdminChannelItem) => (
                <Space size="small">
                    <Tooltip title="优先级（越大越优先匹配）">
                        <Tag color="blue">P: {record.priority}</Tag>
                    </Tooltip>
                    <Tooltip title="轮询权重">
                        <Tag>W: {record.weight}</Tag>
                    </Tooltip>
                </Space>
            ),
        },
        {
            title: "健康状态与延迟",
            key: "health",
            width: 160,
            render: (_: any, record: AdminChannelItem) => {
                if (record.healthStatus === "healthy") {
                    return (
                        <Space size={4}>
                            <Badge status="success" />
                            <Text type="success" className="text-xs">正常 ({record.lastLatencyMs ?? "--"}ms)</Text>
                        </Space>
                    );
                }
                if (record.healthStatus === "degraded") {
                    return (
                        <Space size={4}>
                            <Badge status="warning" />
                            <Text type="warning" className="text-xs">异常警告</Text>
                        </Space>
                    );
                }
                if (record.healthStatus === "unhealthy") {
                    return (
                        <Space size={4}>
                            <Badge status="error" />
                            <Text type="danger" className="text-xs">鉴权失败/失效</Text>
                        </Space>
                    );
                }
                return (
                    <Space size={4}>
                        <Badge status="default" />
                        <Text type="secondary" className="text-xs">未检测</Text>
                    </Space>
                );
            },
        },
        {
            title: "启用状态",
            key: "isActive",
            width: 90,
            render: (_: any, record: AdminChannelItem) => (
                <Switch
                    size="small"
                    checked={record.isActive}
                    onChange={(checked) => handleToggleStatus(record, checked)}
                />
            ),
        },
        {
            title: "操作",
            key: "actions",
            width: 220,
            render: (_: any, record: AdminChannelItem) => (
                <Space size="small">
                    <Tooltip title="连通性测试">
                        <Button
                            size="small"
                            icon={<Activity className={`size-3.5 ${testingId === record.id ? "animate-spin" : ""}`} />}
                            onClick={() => handleTestConnectivity(record)}
                            loading={testingId === record.id}
                        />
                    </Tooltip>

                    <Tooltip title="同步上游模型">
                        <Button
                            size="small"
                            icon={<RotateCw className={`size-3.5 ${syncingId === record.id ? "animate-spin" : ""}`} />}
                            onClick={() => handleSyncModels(record)}
                            loading={syncingId === record.id}
                        />
                    </Tooltip>

                    <Button
                        size="small"
                        icon={<Edit2 className="size-3.5" />}
                        onClick={() => {
                            setEditingChannel(record);
                            setModalOpen(true);
                        }}
                    >
                        编辑
                    </Button>

                    <Popconfirm
                        title="确认删除该渠道？"
                        description="删除后画板将不再分发请求至此渠道。"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => handleDelete(record.id)}
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
                <div className="flex items-center gap-2">
                    <Button
                        type="primary"
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            setEditingChannel(null);
                            setModalOpen(true);
                        }}
                    >
                        新增渠道
                    </Button>
                    <Button
                        icon={<RotateCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
                        onClick={() => void loadChannels(page, limit, search)}
                        disabled={loading}
                    >
                        刷新
                    </Button>
                </div>
            </div>

            <Table
                rowKey="id"
                columns={columns}
                dataSource={channels}
                loading={loading}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 个渠道`,
                    onChange: (p, l) => {
                        setPage(p);
                        setLimit(l);
                        void loadChannels(p, l, search);
                    },
                }}
            />

            <AdminChannelModal
                open={modalOpen}
                channel={editingChannel}
                onCancel={() => {
                    setModalOpen(false);
                    setEditingChannel(null);
                }}
                onSubmit={handleSaveChannel}
            />
        </div>
    );
}
