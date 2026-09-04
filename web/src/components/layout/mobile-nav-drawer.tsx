import { Drawer, Divider, Tag } from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Megaphone, ShieldCheck, BookOpen, Sparkles } from "lucide-react";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useNoticeStore } from "@/stores/use-notice-store";
import { useUserStore } from "@/stores/use-user-store";
import { DOCS_URL } from "@/constant/env";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t, i18n } = useTranslation();
    const user = useUserStore((state) => state.user);
    const openNotice = useNoticeStore((state) => state.openNotice);
    const hasCheckedToday = useNoticeStore((state) => state.hasCheckedToday);
    const notice = useNoticeStore((state) => state.notice);

    const isZh = i18n.language?.startsWith("zh");

    return (
        <Drawer title={t("topNav.navigation")} placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {navigationTools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link
                            key={tool.slug}
                            to={`/${tool.slug}`}
                            onClick={onClose}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-base transition",
                                active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                            )}
                        >
                            <Icon className="size-5" />
                            <span>{t(`navigation.${tool.slug}`)}</span>
                        </Link>
                    );
                })}

                <Divider className="!my-3" />

                {notice?.enabled !== false && (
                    <button
                        type="button"
                        onClick={() => {
                            onClose();
                            openNotice();
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-base text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100 text-left"
                    >
                        <div className="flex items-center gap-3">
                            <Megaphone className="size-5 text-amber-500" />
                            <span>{isZh ? "系统公告" : "Announcements"}</span>
                        </div>
                        {!hasCheckedToday && (
                            <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                        )}
                    </button>
                )}

                {user?.role === "admin" && (
                    <Link
                        to="/admin"
                        onClick={onClose}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-base text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-950/30 transition font-medium"
                    >
                        <ShieldCheck className="size-5" />
                        <span>{isZh ? "管理控制台" : "Admin Console"}</span>
                    </Link>
                )}

                <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-base text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100 transition"
                >
                    <BookOpen className="size-5" />
                    <span>{t("topNav.docs")}</span>
                </a>
            </div>
        </Drawer>
    );
}
