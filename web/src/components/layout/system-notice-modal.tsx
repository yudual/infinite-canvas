import { useState } from "react";
import { Modal, Button, Checkbox, Tag } from "antd";
import { Megaphone, AlertTriangle, CheckCircle2, Sparkles, Lightbulb, AlertCircle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNoticeStore } from "@/stores/use-notice-store";

export function SystemNoticeModal() {
    const { i18n } = useTranslation();
    const open = useNoticeStore((state) => state.open);
    const closeNotice = useNoticeStore((state) => state.closeNotice);
    const notice = useNoticeStore((state) => state.notice);
    const [dontShowToday, setDontShowToday] = useState(false);

    const isZh = i18n.language?.startsWith("zh");

    if (!notice || !notice.enabled) {
        return null;
    }

    const handleOk = () => {
        closeNotice(dontShowToday);
    };

    const handleCancel = () => {
        closeNotice(dontShowToday);
    };

    const noticeDate = notice.updatedAt ? notice.updatedAt.slice(0, 10) : "";

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            centered
            width="min(640px, 94vw)"
            destroyOnClose={false}
            title={
                <div className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
                    <span className="flex size-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                        <Megaphone className="size-4" />
                    </span>
                    <span className="truncate">{notice.tag || (isZh ? "系统公告" : "Announcement")}</span>
                    {notice.tag && (
                        <Tag color={notice.tagColor || "orange"} className="!ml-1 !font-normal">
                            {notice.tag}
                        </Tag>
                    )}
                </div>
            }
            footer={
                <div className="flex items-center justify-between border-t border-stone-200/60 pt-3 dark:border-stone-800/60">
                    <Checkbox
                        checked={dontShowToday}
                        onChange={(e) => setDontShowToday(e.target.checked)}
                        className="text-xs text-stone-500 dark:text-stone-400"
                    >
                        {isZh ? "今日不再弹出" : "Don't show again today"}
                    </Checkbox>
                    <Button type="primary" onClick={handleOk}>
                        {isZh ? "我知道了" : "Got it"}
                    </Button>
                </div>
            }
        >
            <div className="space-y-3.5 py-2 text-stone-700 dark:text-stone-300 max-h-[75vh] overflow-y-auto pr-1">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 sm:p-4 dark:border-amber-500/25 dark:bg-amber-950/20">
                    <div className="flex items-center justify-between gap-2 border-b border-amber-500/15 pb-2.5">
                        <div className="flex items-center gap-1.5 font-semibold text-stone-900 dark:text-stone-100 text-sm">
                            <Sparkles className="size-4 text-amber-500 shrink-0" />
                            <span className="break-words">{notice.title}</span>
                        </div>
                        {noticeDate && <span className="text-[11px] text-stone-400 shrink-0">{noticeDate}</span>}
                    </div>

                    <div className="mt-3 space-y-2.5 text-xs leading-relaxed">
                        {notice.content && (
                            <p className="text-stone-600 dark:text-stone-300 whitespace-pre-wrap">
                                {notice.content}
                            </p>
                        )}

                        {notice.items && notice.items.length > 0 && (
                            <div className="space-y-2 rounded-lg bg-background/70 p-3 shadow-xs">
                                {notice.items.map((item, idx) => (
                                    <div key={idx} className="flex items-start gap-2">
                                        {item.type === "warning" ? (
                                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                        ) : item.type === "error" ? (
                                            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
                                        ) : item.type === "tip" ? (
                                            <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                        ) : (
                                            <Info className="mt-0.5 size-3.5 shrink-0 text-blue-500" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            {item.title && (
                                                <strong
                                                    className={
                                                        item.type === "error"
                                                            ? "text-red-600 dark:text-red-400 mr-1"
                                                            : item.type === "warning"
                                                            ? "text-amber-700 dark:text-amber-300 mr-1"
                                                            : "text-stone-900 dark:text-stone-100 mr-1"
                                                    }
                                                >
                                                    {item.title}
                                                </strong>
                                            )}
                                            <span className="text-stone-600 dark:text-stone-400 whitespace-pre-wrap">
                                                {item.description}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {notice.footerNote && (
                            <p className="text-[11px] text-stone-400 dark:text-stone-500 whitespace-pre-wrap">
                                {notice.footerNote}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
