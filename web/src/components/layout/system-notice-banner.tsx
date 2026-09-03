import { useState, useEffect } from "react";
import { Megaphone, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const NOTICE_STORAGE_KEY = "infinite-canvas:notice:grok-medium-quality-v1";

export function SystemNoticeBanner() {
    const { i18n } = useTranslation();
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const isDismissed = localStorage.getItem(NOTICE_STORAGE_KEY);
        if (!isDismissed) {
            setVisible(true);
        }
    }, []);

    const handleDismiss = () => {
        localStorage.setItem(NOTICE_STORAGE_KEY, "dismissed");
        setVisible(false);
    };

    if (!visible) return null;

    const isZh = i18n.language?.startsWith("zh");

    return (
        <div className="relative z-30 flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 transition-all dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-hidden text-ellipsis">
                <Megaphone className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                    {isZh ? (
                        <>
                            <strong className="font-semibold">系统公告：</strong>
                            由于 Grok 官方接口限制，<code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono text-[11px] text-amber-950 dark:text-amber-100">grok-imagine-image-2.0</code> 图像模型最高仅支持 <span className="font-semibold text-amber-700 dark:text-amber-300">Medium 档位（2K画质）</span>，暂不支持 High 档位。生图或修图时请在画质选项中选择 <strong>Medium</strong>。
                        </>
                    ) : (
                        <>
                            <strong className="font-semibold">Notice:</strong>
                            Due to upstream API limitations, <code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono text-[11px] text-amber-950 dark:text-amber-100">grok-imagine-image-2.0</code> supports up to <span className="font-semibold text-amber-700 dark:text-amber-300">Medium (2K)</span> quality and does not support High. Please select <strong>Medium</strong> when generating or editing images.
                        </>
                    )}
                </span>
            </div>
            <button
                type="button"
                onClick={handleDismiss}
                className="shrink-0 rounded p-1 text-amber-700/70 transition hover:bg-amber-500/20 hover:text-amber-950 dark:text-amber-300/70 dark:hover:text-amber-100"
                aria-label="关闭公告"
                title={isZh ? "关闭公告" : "Dismiss notice"}
            >
                <X className="size-4" />
            </button>
        </div>
    );
}
