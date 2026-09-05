import { useState, useEffect, useCallback } from "react";
import { Table, Button, Tag, Space, Typography, message, Input, Select, Drawer, Descriptions, Card, Statistic } from "antd";
import { RotateCw, Eye, AlertCircle, CheckCircle, Clock } from "lucide-react";
import type { AdminAuditLogItem } from "@/services/api/admin";
import { getAdminAuditLogs } from "@/services/api/admin";

const { Text, Paragraph } = Typography;

export function AdminAuditLogsPanel() {
    const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [search, setSearch] = useState("");

    const [detailLog, setDetailLog] = useState<AdminAuditLogItem | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    const loadLogs = useCallback(async (p = page, l = limit, st = statusFilter, tp = typeFilter, s = search) => {
        try {
            setLoading(true);
            const res = await getAdminAuditLogs({
                page: p,
                limit: l,
                status: st === "all" ? undefined : st,
                requestType: tp === "all" ? undefined : tp,
                search: s.trim() || undefined,
            });
            setLogs(res.logs || []);
            setTotal(res.total || 0);
        } catch (err: any) {
            message.error(err.response?.data?.message || "获取审计日志失败");
        } finally {
            setLoading(false);
        }
    }, [page, limit, statusFilter, typeFilter, search]);

    useEffect(() => {
        void loadLogs(1, limit, statusFilter, typeFilter, "");
    }, [loadLogs, limit, statusFilter, typeFilter]);

    const formatRequestType = (type: string) => {
        switch (type) {
            case "image_generation":
                return <Tag color="blue">生图</Tag>;
            case "image_edit":
                return <Tag color="purple">图像编辑</Tag>;
            case "chat_completion":
                return <Tag color="cyan">对话补全</Tag>;
            default:
                return <Tag>{type}</Tag>;
        }
    };

    const columns = [
        {
            title: "请求时间",
            key: "createdAt",
            width: 170,
            render: (_: any, record: AdminAuditLogItem) => (
                <Text type="secondary" className="text-xs font-mono">
                    {new Date(record.createdAt).toLocaleString()}
                </Text>
            ),
        },
        {
            title: "类型",
            key: "requestType",
            width: 100,
            render: (_: any, record: AdminAuditLogItem) => formatRequestType(record.requestType),
        },
        {
            title: "目标模型",
            key: "model",
            render: (_: any, record: AdminAuditLogItem) => (
                <Text strong className="font-mono text-xs">
                    {record.model}
                </Text>
            ),
        },
        {
            title: "命中渠道",
            key: "channel",
            width: 140,
            render: (_: any, record: AdminAuditLogItem) => (
                <Text ellipsis={{ tooltip: record.channelName || "--" }}>
                    {record.channelName || "--"}
                </Text>
            ),
        },
        {
            title: "调用用户",
            key: "username",
            width: 110,
            render: (_: any, record: AdminAuditLogItem) => <Text>{record.username || "游客"}</Text>,
        },
        {
            title: "状态",
            key: "status",
            width: 120,
            render: (_: any, record: AdminAuditLogItem) => {
                if (record.status === "success") {
                    return (
                        <Tag color="success" icon={<CheckCircle className="inline size-3 mr-1" />}>
                            {record.statusCode}
                        </Tag>
                    );
                }
                return (
                    <Tag color="error" icon={<AlertCircle className="inline size-3 mr-1" />}>
                        {record.statusCode || "ERR"}
                    </Tag>
                );
            },
        },
        {
            title: "耗时",
            key: "durationMs",
            width: 100,
            render: (_: any, record: AdminAuditLogItem) => {
                const ms = record.durationMs;
                let color = "text-emerald-600";
                if (ms > 10000) color = "text-red-500";
                else if (ms > 3000) color = "text-amber-500";
                return <span className={`font-mono text-xs font-semibold ${color}`}>{ms}ms</span>;
            },
        },
        {
            title: "提示词摘要",
            key: "promptPreview",
            render: (_: any, record: AdminAuditLogItem) => (
                <Paragraph ellipsis={{ rows: 1 }} className="!mb-0 text-xs text-stone-500">
                    {record.promptPreview || "--"}
                </Paragraph>
            ),
        },
        {
            title: "操作",
            key: "actions",
            width: 90,
            render: (_: any, record: AdminAuditLogItem) => (
                <Button
                    size="small"
                    icon={<Eye className="size-3.5" />}
                    onClick={() => {
                        setDetailLog(record);
                        setDrawerOpen(true);
                    }}
                >
                    详情
                </Button>
            ),
        },
    ];

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card size="small"><Statistic title="当前筛选记录" value={total} valueStyle={{ fontSize: 22 }} /></Card>
                <Card size="small"><Statistic title="本页成功" value={logs.filter((log) => log.status === "success").length} valueStyle={{ fontSize: 22, color: "#16a34a" }} /></Card>
                <Card size="small"><Statistic title="本页失败" value={logs.filter((log) => log.status !== "success").length} valueStyle={{ fontSize: 22, color: "#dc2626" }} /></Card>
                <Card size="small"><Statistic title="本页平均耗时" value={logs.length ? Math.round(logs.reduce((sum, log) => sum + log.durationMs, 0) / logs.length) : 0} suffix="ms" valueStyle={{ fontSize: 22 }} /></Card>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={statusFilter}
                        onChange={(val) => {
                            setStatusFilter(val);
                            setPage(1);
                        }}
                        style={{ width: 110 }}
                        options={[
                            { label: "所有状态", value: "all" },
                            { label: "成功", value: "success" },
                            { label: "失败", value: "failed" },
                        ]}
                    />

                    <Select
                        value={typeFilter}
                        onChange={(val) => {
                            setTypeFilter(val);
                            setPage(1);
                        }}
                        style={{ width: 130 }}
                        options={[
                            { label: "所有类型", value: "all" },
                            { label: "AI 生图", value: "image_generation" },
                            { label: "图像编辑", value: "image_edit" },
                            { label: "对话补全", value: "chat_completion" },
                        ]}
                    />

                    <Input.Search
                        placeholder="检索提示词或错误..."
                        defaultValue={search}
                        onSearch={(val) => {
                            setSearch(val);
                            setPage(1);
                            void loadLogs(1, limit, statusFilter, typeFilter, val);
                        }}
                        allowClear
                        className="w-56"
                    />

                    <Button
                        icon={<RotateCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
                        onClick={() => void loadLogs(page, limit, statusFilter, typeFilter, search)}
                        disabled={loading}
                    />
                </div>
            </div>

            <Table
                rowKey="id"
                columns={columns}
                dataSource={logs}
                loading={loading}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 条审计记录`,
                    onChange: (p, l) => {
                        setPage(p);
                        setLimit(l);
                        void loadLogs(p, l, statusFilter, typeFilter, search);
                    },
                }}
                scroll={{ x: "max-content" }}
            />

            <Drawer
                title="AI 调用审计详情"
                open={drawerOpen}
                onClose={() => {
                    setDrawerOpen(false);
                    setDetailLog(null);
                }}
                width={600}
                destroyOnClose
            >
                {detailLog && (
                    <Descriptions column={1} bordered size="small">
                        <Descriptions.Item label="日志 ID">{detailLog.id}</Descriptions.Item>
                        <Descriptions.Item label="调用时间">{new Date(detailLog.createdAt).toLocaleString()}</Descriptions.Item>
                        <Descriptions.Item label="调用用户">{detailLog.username || "游客"}</Descriptions.Item>
                        <Descriptions.Item label="客户端 IP">{detailLog.ipAddress || "未知"}</Descriptions.Item>
                        <Descriptions.Item label="请求类型">{formatRequestType(detailLog.requestType)}</Descriptions.Item>
                        <Descriptions.Item label="目标模型">{detailLog.model}</Descriptions.Item>
                        <Descriptions.Item label="命中渠道">{detailLog.channelName || "--"}</Descriptions.Item>
                        <Descriptions.Item label="状态与状态码">
                            <Tag color={detailLog.status === "success" ? "success" : "error"}>
                                {detailLog.status.toUpperCase()} ({detailLog.statusCode})
                            </Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="总响应耗时">{detailLog.durationMs} ms</Descriptions.Item>
                        {detailLog.retryCount > 0 && (
                            <Descriptions.Item label="重试次数">{detailLog.retryCount} 次</Descriptions.Item>
                        )}
                        <Descriptions.Item label="提示词内容">
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs font-mono">
                                {detailLog.promptPreview || "无提示词"}
                            </pre>
                        </Descriptions.Item>
                        {detailLog.errorMessage && (
                            <Descriptions.Item label="错误异常明细">
                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-2 text-xs font-mono text-red-700">
                                    {detailLog.errorMessage}
                                </pre>
                            </Descriptions.Item>
                        )}
                        {detailLog.responseSummary && (
                            <Descriptions.Item label="响应摘要">
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs font-mono">
                                    {detailLog.responseSummary}
                                </pre>
                            </Descriptions.Item>
                        )}
                    </Descriptions>
                )}
            </Drawer>
        </div>
    );
}
