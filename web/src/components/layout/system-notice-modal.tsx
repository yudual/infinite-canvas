import { useState } from "react";
import { Modal, Button, Checkbox, Tag } from "antd";
import { Megaphone, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNoticeStore } from "@/stores/use-notice-store";

export function SystemNoticeModal() {
    const { t, i18n } = useTranslation();
    const open = useNoticeStore((state) => state.open);
    const closeNotice = useNoticeStore((state) => state.closeNotice);
    const [dontShowToday, setDontShowToday] = useState(false);

    const isZh = i18n.language?.startsWith("zh");

    const handleOk = () => {
        closeNotice(dontShowToday);
    };

    const handleCancel = () => {
        closeNotice(dontShowToday);
    };

    return (
        <Modal
            open={open}
            onCancel={handleCancel}
            centered
            width={640}
            destroyOnClose={false}
            title={
                <div className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
                    <span className="flex size-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                        <Megaphone className="size-4" />
                    </span>
                    <span>{isZh ? "系统公告" : "System Announcement"}</span>
                    <Tag color="orange" className="!ml-1 !font-normal">
                        {isZh ? "重要通知" : "Important"}
                    </Tag>
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
            <div className="space-y-3.5 py-2 text-stone-700 dark:text-stone-300">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 dark:border-amber-500/25 dark:bg-amber-950/20">
                    <div className="flex items-center justify-between gap-2 border-b border-amber-500/15 pb-2.5">
                        <div className="flex items-center gap-1.5 font-semibold text-stone-900 dark:text-stone-100 text-sm">
                            <Sparkles className="size-4 text-amber-500" />
                            <span>
                                {isZh
                                    ? "关于 Grok 2.0 图像模型画质设置的重要说明"
                                    : "Notice on Grok 2.0 Image Quality Limitations"}
                            </span>
                        </div>
                        <span className="text-[11px] text-stone-400">2026-09-03</span>
                    </div>

                    <div className="mt-3 space-y-2.5 text-xs leading-relaxed">
                        <p className="text-stone-600 dark:text-stone-300">
                            {isZh ? (
                                <>
                                    近期接入的 <code className="rounded bg-stone-200/80 px-1 py-0.5 font-mono text-[11px] text-stone-900 dark:bg-stone-800 dark:text-stone-200">grok-imagine-image-2.0</code> 图像生成与编辑模型，在调用时请注意以下说明：
                                </>
                            ) : (
                                <>
                                    For the newly connected <code className="rounded bg-stone-200/80 px-1 py-0.5 font-mono text-[11px] text-stone-900 dark:bg-stone-800 dark:text-stone-200">grok-imagine-image-2.0</code> image model, please note the following details:
                                </>
                            )}
                        </p>

                        <div className="space-y-2 rounded-lg bg-background/60 p-3">
                            <div className="flex items-start gap-2">
                                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                <div>
                                    <strong className="text-stone-900 dark:text-stone-100">
                                        {isZh ? "最高画质支持 Medium（2K）：" : "Maximum Quality is Medium (2K): "}
                                    </strong>
                                    <span className="text-stone-600 dark:text-stone-400">
                                        {isZh
                                            ? "xAI 官方底层接口目前仅开放了 Medium（2K 高清）与 Low（1K 极速）两个档位，Medium 即为官方当前最高画质。"
                                            : "xAI upstream currently only supports Medium (2K) and Low (1K). Medium is already the top resolution provided by the upstream API."}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-start gap-2">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
                                <div>
                                    <strong className="text-red-600 dark:text-red-400">
                                        {isZh ? "切勿选择 High（高质量）档位：" : "Do NOT select High quality: "}
                                    </strong>
                                    <span className="text-stone-600 dark:text-stone-400">
                                        {isZh ? (
                                            <>
                                                因官方未开放 High 档位，选 High 会被官方接口拦截并报错 <code className="rounded bg-red-50 px-1 py-0.5 font-mono text-red-600 dark:bg-red-950/40 dark:text-red-400">400 (quality 必须是 low 或 medium)</code>，导致生图任务失败。
                                            </>
                                        ) : (
                                            <>
                                                Requests with High quality are directly rejected by xAI with a 400 parameter error.
                                            </>
                                        )}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-start gap-2">
                                <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center font-bold text-emerald-600 dark:text-emerald-400">
                                    💡
                                </span>
                                <div>
                                    <strong className="text-stone-900 dark:text-stone-100">
                                        {isZh ? "使用建议：" : "Recommendation: "}
                                    </strong>
                                    <span className="text-stone-600 dark:text-stone-400">
                                        {isZh
                                            ? "在画布或生图工作台右侧面板中，将画质设为 Medium 即可正常极速出图。"
                                            : "Select Medium quality in the image settings panel for optimal 2K generation."}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <p className="text-[11px] text-stone-400 dark:text-stone-500">
                            {isZh
                                ? "ℹ️ 后续若 xAI 官方开放 High 档位，系统将第一时间解除限制，请留意后续公告。"
                                : "ℹ️ Once xAI officially enables High quality support, our gateway will immediately follow up."}
                        </p>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
