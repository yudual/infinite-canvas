import { useState, useEffect, useCallback } from "react";
import { Table, Button, Image, Popconfirm, Space, Tag, Typography, message, Card, Input } from "antd";
import { Trash2, RotateCw, Sparkles, HardDrive, Download, AlertTriangle } from "lucide-react";
import type { AdminAssetItem, AdminAssetStats } from "@/services/api/admin";
import {
    getAdminAssets,
    getAdminAssetStats,
    deleteAdminAsset,
    batchDeleteAdminAssets,
    cleanupAdminOrphanAssets,
} from "@/services/api/admin";
import { formatBytes } from "@/lib/image-utils";

const { Text } = Typography;

export function AdminAssetsPanel() {
    const [assets, setAssets] = useState<AdminAssetItem[]>([]);
    const [stats, setStats] = useState<AdminAssetStats | null>(null);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [search, setSearch] = useState("");
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

    const [cleaningOrphans, setCleaningOrphans] = useState(false);
    const [batchDeleting, setBatchDeleting] = useState(false);

    const loadData = useCallback(async (p = page, l = limit, s = search) => {
        try {
            setLoading(true);
            const [assetRes, statsRes] = await Promise.all([
                getAdminAssets({ page: p, limit: l, search: s.trim() || undefined }),
                getAdminAssetStats().catch(() => null),
            ]);
            setAssets(assetRes.assets || []);
            setTotal(assetRes.total || 0);
            if (statsRes) {
                setStats(statsRes);
            }
        } catch (err: any) {
            message.error(err.response?.data?.message || "获取素材列表失败");
        } finally {
            setLoading(false);
        }
    }, [page, limit, search]);

    useEffect(() => {
        void loadData(1, limit, "");
    }, [loadData, limit]);

    const handleDeleteSingle = async (id: string) => {
        try {
            await deleteAdminAsset(id);
            message.success("素材删除成功");
            void loadData(page, limit, search);
        } catch (err: any) {
            message.error(err.response?.data?.message || "删除素材失败");
        }
    };

    const handleBatchDelete = async () => {
        if (selectedRowKeys.length === 0) return;
        try {
            setBatchDeleting(true);
            const res = await batchDeleteAdminAssets(selectedRowKeys as string[]);
            message.success(`成功删除 ${res.deletedCount} 个素材，释放 ${formatBytes(res.totalBytesFreed)} 空间`);
            setSelectedRowKeys([]);
            void loadData(page, limit, search);
        } catch (err: any) {
            message.error(err.response?.data?.message || "批量删除失败");
        } finally {
            setBatchDeleting(false);
        }
    };

    const handleCleanupOrphans = async () => {
        try {
            setCleaningOrphans(true);
            const res = await cleanupAdminOrphanAssets();
            if (res.removedCount > 0) {
                message.success(`已清理 ${res.removedCount} 个磁盘孤儿文件，释放 ${formatBytes(res.totalBytesFreed)} 空间`);
            } else {
                message.info("磁盘中未发现孤儿素材文件");
            }
            void loadData(page, limit, search);
        } catch (err: any) {
            message.error(err.response?.data?.message || "清理孤儿文件失败");
        } finally {
            setCleaningOrphans(false);
        }
    };

    const columns = [
        {
            title: "缩略图",
            key: "thumbnail",
            width: 70,
            render: (_: any, record: AdminAssetItem) => (
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded bg-stone-100">
                    <Image
                        src={record.url}
                        alt={record.originalName}
                        width={48}
                        height={48}
                        style={{ objectFit: "cover" }}
                        fallback="/favicon.ico"
                    />
                </div>
            ),
        },
        {
            title: "文件名与哈希",
            key: "name",
            render: (_: any, record: AdminAssetItem) => (
                <Space direction="vertical" size={2}>
                    <Text strong ellipsis={{ tooltip: record.originalName }}>
                        {record.originalName}
                    </Text>
                    <Text type="secondary" className="font-mono text-xs">
                        {record.filename}
                    </Text>
                </Space>
            ),
        },
        {
            title: "上传者",
            key: "user",
            width: 130,
            render: (_: any, record: AdminAssetItem) => (
                <Text>{record.userDisplayName || record.username || "公共素材"}</Text>
            ),
        },
        {
            title: "格式",
            key: "mimeType",
            width: 100,
            render: (_: any, record: AdminAssetItem) => <Tag>{record.mimeType.replace("image/", "")}</Tag>,
        },
        {
            title: "体积",
            key: "sizeBytes",
            width: 110,
            render: (_: any, record: AdminAssetItem) => <Text>{formatBytes(record.sizeBytes)}</Text>,
        },
        {
            title: "上传时间",
            key: "createdAt",
            width: 160,
            render: (_: any, record: AdminAssetItem) => (
                <Text type="secondary" className="text-xs">
                    {new Date(record.createdAt).toLocaleString()}
                </Text>
            ),
        },
        {
            title: "操作",
            key: "actions",
            width: 120,
            render: (_: any, record: AdminAssetItem) => (
                <Space size="small">
                    <Button
                        size="small"
                        icon={<Download className="size-3.5" />}
                        href={record.url}
                        target="_blank"
                    />
                    <Popconfirm
                        title="确认彻底删除该素材？"
                        description="数据库记录与物理磁盘文件将被一并销毁。"
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
            {stats && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Card size="small">
                        <Text type="secondary" className="text-xs">已登记素材总数</Text>
                        <div className="text-xl font-bold mt-1">{stats.totalAssetCount} 份</div>
                    </Card>
                    <Card size="small">
                        <Text type="secondary" className="text-xs">素材总占用空间</Text>
                        <div className="text-xl font-bold mt-1">{formatBytes(stats.totalStorageBytes)}</div>
                    </Card>
                    <Card size="small">
                        <div className="flex items-center justify-between">
                            <div>
                                <Text type="secondary" className="text-xs">磁盘孤儿文件</Text>
                                <div className="text-xl font-bold mt-1">
                                    {stats.orphanCount} 个 ({formatBytes(stats.orphanBytes)})
                                </div>
                            </div>
                            {stats.orphanCount > 0 && (
                                <Button
                                    size="small"
                                    danger
                                    loading={cleaningOrphans}
                                    onClick={handleCleanupOrphans}
                                >
                                    清理孤儿
                                </Button>
                            )}
                        </div>
                    </Card>
                </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center gap-2 sm:max-w-md">
                    <Input.Search
                        placeholder="搜索素材文件名..."
                        defaultValue={search}
                        onSearch={(val) => {
                            setSearch(val);
                            setPage(1);
                            void loadData(1, limit, val);
                        }}
                        allowClear
                    />
                    <Button
                        icon={<RotateCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
                        onClick={() => void loadData(page, limit, search)}
                        disabled={loading}
                    />
                </div>

                {selectedRowKeys.length > 0 && (
                    <Popconfirm
                        title={`确认批量删除选中的 ${selectedRowKeys.length} 个素材？`}
                        description="将从数据库与磁盘中同步彻底移除。"
                        okText="彻底删除"
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
                dataSource={assets}
                loading={loading}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 个素材`,
                    onChange: (p, l) => {
                        setPage(p);
                        setLimit(l);
                        void loadData(p, l, search);
                    },
                }}
                scroll={{ x: "max-content" }}
            />
        </div>
    );
}
