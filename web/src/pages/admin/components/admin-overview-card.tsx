import { Card, Button, Spin, Statistic } from "antd";
import { Users, UserCheck, FolderKanban, Image as ImageIcon, HardDrive, RotateCw } from "lucide-react";
import type { SystemStats } from "@/services/api/admin";

type AdminOverviewCardProps = {
    stats: SystemStats | null;
    loading: boolean;
    onRefresh: () => void;
};

function formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function AdminOverviewCard({ stats, loading, onRefresh }: AdminOverviewCardProps) {
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
            value: formatBytes(stats?.storageBytes),
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
                        <Card key={idx} className="border border-stone-200/80 shadow-xs dark:border-stone-800" size="small">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{card.title}</span>
                                {card.icon}
                            </div>
                            <div className="mt-3">
                                {card.isCustomValue ? (
                                    <div className="text-2xl font-bold tracking-tight text-stone-950 dark:text-stone-100">
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
        </div>
    );
}
