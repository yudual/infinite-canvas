import { useState } from "react";
import { Modal, Button, Checkbox, Tag } from "antd";
import { Megaphone, AlertTriangle, CheckCircle2, Sparkles, Lightbulb, AlertCircle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNoticeStore } from "@/stores/use-notice-store";

function FormattedNoticeText({ text }: { text: string }) {
    if (!text) return null;
    const lines = text.split("\n");
    return (
        <div className="space-y-1.5 leading-relaxed">
            {lines.map((line, idx) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={idx} className="h-1.5" />;
                const isBullet = trimmed.startsWith("- ") || trimmed.startsWith("• ");
                const lineContent = isBullet ? trimmed.slice(2) : line;

                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const parts = lineContent.split(urlRegex);

                const renderedParts = parts.map((part, pIdx) => {
                    if (part.match(/^https?:\/\//)) {
                        return (
                            <a
                                key={pIdx}
                                href={part}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-600 underline underline-offset-2 break-all"
                            >
                                {part}
                            </a>
                        );
                    }
                    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
                    return (
                        <span key={pIdx}>
                            {boldParts.map((bp, bIdx) => {
                                if (bp.startsWith("**") && bp.endsWith("**")) {
                                    return <strong key={bIdx} className="font-semibold text-stone-900 dark:text-stone-100">{bp.slice(2, -2)}</strong>;
                                }
                                return bp;
                            })}
                        </span>
                    );
                });

                if (isBullet) {
                    return (
                        <div key={idx} className="flex items-start gap-1.5 ml-1">
                            <span className="text-amber-500 text-sm leading-none mt-0.5">•</span>
                            <span>{renderedParts}</span>
                        </div>
                    );
                }

                return <p key={idx} className="m-0">{renderedParts}</p>;
            })}
        </div>
    );
}

export function SystemNoticeModal() {
    const { i18n } = useTranslation();
    const open = useNoticeStore((state) => state.open);
    const closeNotice = useNoticeStore((state) => state.closeNotice);
    const notice = useNoticeStore((state) => state.notice);
    const [dontShowToday, setDontShowToday] = useState(false);

    const isZh = i18n.language?.startsWith("zh");

    if (!notice || !notice.enabled) {
        if (!open) return null;
        return (
            <Modal
                open={open}
                onCancel={() => closeNotice()}
                centered
                width="min(480px, 92vw)"
                title={
                    <div className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
                        <span className="flex size-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                            <Megaphone className="size-4" />
                        </span>
                        <span>{isZh ? "全站系统公告" : "System Notice"}</span>
                    </div>
                }
                footer={
                    <div className="flex justify-end border-t border-stone-200/60 pt-3 dark:border-stone-800/60">
                        <Button type="primary" onClick={() => closeNotice()}>
                            {isZh ? "我知道了" : "Got it"}
                        </Button>
                    </div>
                }
            >
                <div className="py-8 text-center text-stone-500 dark:text-stone-400">
                    <Megaphone className="mx-auto mb-3 size-10 text-stone-300 dark:text-stone-600" />
                    <p className="text-sm font-medium">{isZh ? "当前暂无生效中的全站系统公告" : "No active system announcements at this time."}</p>
                </div>
            </Modal>
        );
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
                    <span className="truncate">{isZh ? "全站系统公告" : "System Notice"}</span>
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
                            <div className="text-stone-600 dark:text-stone-300">
                                <FormattedNoticeText text={notice.content} />
                            </div>
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
                            <div className="text-[11px] text-stone-400 dark:text-stone-500 pt-1 border-t border-amber-500/10">
                                <FormattedNoticeText text={notice.footerNote} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
