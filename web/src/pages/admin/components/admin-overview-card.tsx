import { Card, Button, Spin, Statistic, Tag } from "antd";
import { Users, UserCheck, FolderKanban, Image as ImageIcon, HardDrive, RotateCw, Megaphone } from "lucide-react";
import type { SystemStats } from "@/services/api/admin";
import { formatBytes } from "@/lib/image-utils";
import { useNoticeStore } from "@/stores/use-notice-store";

type AdminOverviewCardProps = {
    stats: SystemStats | null;
    loading: boolean;
    onRefresh: () => void;
    onSwitchTab?: (tabKey: string) => void;
};

export function AdminOverviewCard({ stats, loading, onRefresh, onSwitchTab }: AdminOverviewCardProps) {
    const notice = useNoticeStore((state) => state.notice);
    const cards = [
        {
            title: "总用户数",
            value: stats?.userCount ?? 0,
            icon: <Users className="size-5 text-stone-500 dark:text-stone-400" />,
            suffix: "人",
        },
        {
            title: "正常活跃用户",
            value: stats?.activeUserCount ?? stats?.userCount ?? 0,
            icon: <UserCheck className="size-5 text-emerald-600 dark:text-emerald-400" />,
            suffix: "人",
        },
        {
            title: "云端画布项目",
            value: stats?.projectCount ?? 0,
            icon: <FolderKanban className="size-5 text-stone-500 dark:text-stone-400" />,
            suffix: "个",
        },
        {
            title: "存储素材总数",
            value: stats?.assetCount ?? 0,
            icon: <ImageIcon className="size-5 text-stone-500 dark:text-stone-400" />,
            suffix: "件",
        },
        {
            title: "素材存储空间",
            value: formatBytes(stats?.storageBytes ?? 0),
            icon: <HardDrive className="size-5 text-stone-500 dark:text-stone-400" />,
            isCustomValue: true,
        },
    ];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100">系统运行概览</h2>
                    <p className="text-xs text-stone-500 dark:text-stone-400">实时汇总系统用户、项目与资源占用统计</p>
                </div>
                <Button
                    type="text"
                    icon={<RotateCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
                    onClick={onRefresh}
                    disabled={loading}
                >
                    刷新统计
                </Button>
            </div>

            {loading && !stats ? (
                <div className="flex h-32 items-center justify-center">
                    <Spin />
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {cards.map((card, idx) => (
                        <Card key={idx} size="small">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-stone-500">{card.title}</span>
                                {card.icon}
                            </div>
                            <div className="mt-3">
                                {card.isCustomValue ? (
                                    <div className="text-2xl font-bold tracking-tight">
                                        {card.value}
                                    </div>
                                ) : (
                                    <Statistic
                                        value={typeof card.value === "number" ? card.value : 0}
                                        suffix={<span className="text-xs text-stone-400 ml-1">{card.suffix}</span>}
                                        valueStyle={{ fontSize: "1.5rem", fontWeight: 700 }}
                                    />
                                )}
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* System Announcement Status Card */}
            <div className="rounded-xl border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                        <Megaphone className="size-5" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-stone-900 dark:text-stone-100">全站系统公告状态</span>
                            <Tag color={notice?.enabled ? "green" : "default"} className="!m-0">
                                {notice?.enabled ? "已开启生效中" : "已停用"}
                            </Tag>
                        </div>
                        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 truncate">
                            当前公告：{notice?.title || "未配置公告内容"}
                        </p>
                    </div>
                </div>
                <Button type="primary" ghost size="small" className="shrink-0" onClick={() => onSwitchTab?.("notice")}>
                    前往配置公告
                </Button>
            </div>
        </div>
    );
}
