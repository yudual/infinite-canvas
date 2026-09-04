import { useState, useEffect } from "react";
import {
    Card,
    Form,
    Input,
    Switch,
    Button,
    Select,
    Tag,
    App,
    Divider,
    Alert,
    Dropdown,
    Modal,
    Checkbox,
} from "antd";
import {
    Megaphone,
    Save,
    RotateCw,
    Plus,
    Trash2,
    Eye,
    Sparkles,
    AlertTriangle,
    Lightbulb,
    AlertCircle,
    Info,
    ChevronDown,
} from "lucide-react";
import {
    getAdminNotice,
    updateAdminNotice,
    resetAdminNotice,
    type SystemNoticeConfig,
    type NoticeItem,
} from "@/services/api/admin";
import { useNoticeStore } from "@/stores/use-notice-store";

const NOTICE_TEMPLATES: Record<string, { label: string; data: Partial<SystemNoticeConfig> }> = {
    grok: {
        label: "Grok 2.0 画质说明模板 (系统默认)",
        data: {
            enabled: true,
            title: "关于 Grok 2.0 图像模型画质设置的重要说明",
            tag: "重要通知",
            tagColor: "orange",
            content: "近期接入的 grok-imagine-image-2.0 图像生成与编辑模型，在调用时请注意以下说明：",
            items: [
                {
                    title: "最高画质支持 Medium（2K）：",
                    description: "xAI 官方底层接口目前仅开放了 Medium（2K 高清）与 Low（1K 极速）两个档位，Medium 即为官方当前最高画质。",
                    type: "warning",
                },
                {
                    title: "切勿选择 High（高质量）档位：",
                    description: "因官方未开放 High 档位，选 High 会被官方接口拦截并报错 400 (quality 必须是 low 或 medium)，导致生图任务失败。",
                    type: "error",
                },
                {
                    title: "使用建议：",
                    description: "在画布或生图工作台右侧面板中，将画质设为 Medium 即可正常极速出图。",
                    type: "tip",
                },
            ],
            footerNote: "ℹ️ 后续若 xAI 官方开放 High 档位，系统将第一时间解除限制，请留意后续公告。",
        },
    },
    maintenance: {
        label: "系统升级 / 停机维护通知模板",
        data: {
            enabled: true,
            title: "系统核心算力升级与服务维护公告",
            tag: "系统维护",
            tagColor: "red",
            content: "为了提供更加稳定和极速的生成服务，平台将于近期开展算力集群与底层服务升级：",
            items: [
                {
                    title: "维护时间窗口：",
                    description: "预计于本周六凌晨 02:00 - 04:00 进行，期间图像与视频任务可能暂停提交或排队稍长。",
                    type: "warning",
                },
                {
                    title: "数据资产安全：",
                    description: "所有用户的画布工程、历史素材与账户配置均已做多重冷备，维护不影响任何历史数据。",
                    type: "info",
                },
                {
                    title: "建议事项：",
                    description: "维护开始前请确保画布关键进度已完成，避免在维护时间窗口内批量发起耗时较长的长视频生成。",
                    type: "tip",
                },
            ],
            footerNote: "ℹ️ 维护完成后系统服务将全自动恢复，若遇异常情况请联系管理员。",
        },
    },
    release: {
        label: "版本更新 / 移动端与手势支持上线模板",
        data: {
            enabled: true,
            title: "Yu-canvas 移动端触控优化与公告自设系统全新上线！",
            tag: "功能发布",
            tagColor: "green",
            content: "平台已全面升级移动端操控与系统配置体系，核心更新亮点如下：",
            items: [
                {
                    title: "移动端触控手势全套支持：",
                    description: "已支持双指捏合缩放（Pinch-to-zoom）、双指平移视口、单指背景平移以及节点缩放与连线触控优化。",
                    type: "tip",
                },
                {
                    title: "响应式界面布局：",
                    description: "工具栏支持横向触摸平滑滚动，顶部栏自动自适应，小屏手机不再遮挡画布内容。",
                    type: "info",
                },
                {
                    title: "全站公告后台随时自主设置：",
                    description: "管理员可在后台自由设置全站弹窗公告、标签风格、注意事项条目，保存即时向全体用户下发更新。",
                    type: "info",
                },
            ],
            footerNote: "✨ 感谢各位创作者的陪伴与反馈，更多强大功能正在快马加鞭研发中！",
        },
    },
    community: {
        label: "社区交流 / 使用指南模板",
        data: {
            enabled: true,
            title: "欢迎加入 Yu-canvas 创作者交流群与使用指南",
            tag: "社区指南",
            tagColor: "blue",
            content: "欢迎各位设计师与创作者使用 Yu-canvas 无限画布，探索 AI 视听生成的无限创意边界！",
            items: [
                {
                    title: "官方使用文档：",
                    description: "点击顶栏或侧边栏「使用文档」即可查阅画质配置、参数调优与快捷键进阶指南。",
                    type: "info",
                },
                {
                    title: "创作者交流群：",
                    description: "欢迎添加小助手微信或加入交流群，与其他创作者交流生图 Prompt 与节点工作流心得。",
                    type: "tip",
                },
                {
                    title: "合规使用提示：",
                    description: "请严格遵守法律法规，请勿生成违法不良图文视频内容，系统已全面开启合规审计。",
                    type: "warning",
                },
            ],
            footerNote: "🎉 祝您创作愉快，随时随地释放无限灵感！",
        },
    },
};

const TAG_COLOR_OPTIONS = [
    { label: "橙色 (警示/重要)", value: "orange" },
    { label: "蓝色 (信息/通知)", value: "blue" },
    { label: "绿色 (新特性/发布)", value: "green" },
    { label: "红色 (严重/停机)", value: "red" },
    { label: "紫色 (特殊/专属)", value: "purple" },
];

const ITEM_TYPE_OPTIONS = [
    { label: "⚠️ 警示提示 (Warning)", value: "warning" },
    { label: "🚫 错误/禁止 (Error)", value: "error" },
    { label: "💡 实用建议 (Tip)", value: "tip" },
    { label: "ℹ️ 常规信息 (Info)", value: "info" },
];

export function AdminNoticePanel() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [realModalOpen, setRealModalOpen] = useState(false);
    const [previewNotice, setPreviewNotice] = useState<Partial<SystemNoticeConfig>>({});
    const fetchPublicNotice = useNoticeStore((state) => state.fetchNotice);

    const loadNotice = async () => {
        setLoading(true);
        try {
            const res = await getAdminNotice();
            if (res.success && res.notice) {
                form.setFieldsValue(res.notice);
                setPreviewNotice(res.notice);
            }
        } catch (err: any) {
            message.error(err.message || "加载公告配置失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadNotice();
    }, []);

    const handleValuesChange = (_changed: any, allValues: any) => {
        setPreviewNotice({ ...allValues, updatedAt: previewNotice.updatedAt });
    };

    const syncPreviewFromForm = () => {
        setTimeout(() => {
            const vals = form.getFieldsValue(true);
            setPreviewNotice({ ...vals, updatedAt: previewNotice.updatedAt });
        }, 50);
    };

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            setSaving(true);
            const res = await updateAdminNotice(values);
            if (res.success) {
                message.success(res.message || "系统公告保存成功，所有用户端已即刻生效");
                setPreviewNotice(res.notice);
                void fetchPublicNotice();
            }
        } catch (err: any) {
            if (err.errorFields) return;
            message.error(err.message || "保存系统公告失败");
        } finally {
            setSaving(false);
        }
    };

    const handleApplyTemplate = (key: string) => {
        const tpl = NOTICE_TEMPLATES[key];
        if (!tpl) return;
        form.setFieldsValue(tpl.data);
        setPreviewNotice({ ...tpl.data, updatedAt: previewNotice.updatedAt });
        message.info(`已填入「${tpl.label}」，确认无误后点击「保存公告配置」即可发布`);
    };

    const handleResetToDefault = () => {
        modal.confirm({
            title: "确认恢复出厂初始公告？",
            content: "此操作将重置数据库中的系统公告为默认 Grok 2.0 规格说明模板，并立即向全站用户同步更新版本时间戳。",
            okText: "确认重置",
            okType: "danger",
            cancelText: "取消",
            onOk: async () => {
                try {
                    setSaving(true);
                    const res = await resetAdminNotice();
                    if (res.success && res.notice) {
                        form.setFieldsValue(res.notice);
                        setPreviewNotice(res.notice);
                        message.success("已恢复为初始默认公告配置并同步云端");
                        void fetchPublicNotice();
                    }
                } catch (err: any) {
                    message.error(err.message || "恢复出厂公告失败");
                } finally {
                    setSaving(false);
                }
            },
        });
    };

    const noticeDate = previewNotice.updatedAt ? previewNotice.updatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100 flex items-center gap-2">
                        <Megaphone className="size-5 text-amber-500" />
                        全站系统公告配置
                    </h2>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                        在此可自主配置全站弹窗公告的标题、正文、注意事项列表及展示开关，修改后全平台用户即刻同步生效。
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        icon={<RotateCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
                        onClick={loadNotice}
                        disabled={loading}
                    >
                        重新加载
                    </Button>
                    <Dropdown
                        menu={{
                            items: [
                                ...Object.entries(NOTICE_TEMPLATES).map(([k, tpl]) => ({
                                    key: k,
                                    label: tpl.label,
                                    onClick: () => handleApplyTemplate(k),
                                })),
                                { type: "divider" as const },
                                {
                                    key: "reset-default",
                                    label: "🔄 恢复为出厂初始设置 (重置云端)",
                                    danger: true,
                                    onClick: () => handleResetToDefault(),
                                },
                            ],
                        }}
                    >
                        <Button icon={<Sparkles className="size-4 text-amber-500" />}>
                            套用预设模板 <ChevronDown className="size-3.5 ml-1 opacity-60" />
                        </Button>
                    </Dropdown>
                    <Button
                        icon={<Eye className="size-4 text-blue-500" />}
                        onClick={() => setRealModalOpen(true)}
                    >
                        实机弹窗预览
                    </Button>
                    <Button
                        type="primary"
                        icon={<Save className="size-4" />}
                        loading={saving}
                        onClick={handleSave}
                    >
                        保存公告配置
                    </Button>
                </div>
            </div>

            <Alert
                type="info"
                showIcon
                className="text-xs"
                message="关于后台公告自主设置与下发机制"
                description={
                    <span>
                        管理员在此随时自主编辑并保存后，配置将即刻写入数据库并向全站用户端同步。保存操作会自动更新公告版本时间戳（当前版本：{previewNotice.updatedAt ? new Date(previewNotice.updatedAt).toLocaleString() : "未发布"}）。<strong>即使普通用户此前勾选过「今日不再弹出」，一旦管理员更新发布了新公告，全站用户端也会重新主动弹出最新公告</strong>，确保重要通知必达。
                    </span>
                }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Form Section */}
                <div className="lg:col-span-7">
                    <Card
                        title="编辑公告内容"
                        className="shadow-xs"
                        extra={
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-stone-500">启用状态:</span>
                                <Form.Item
                                    name="enabled"
                                    valuePropName="checked"
                                    noStyle
                                >
                                    <Switch checkedChildren="已开启" unCheckedChildren="已关闭" />
                                </Form.Item>
                            </div>
                        }
                    >
                        <Form
                            form={form}
                            layout="vertical"
                            initialValues={{
                                enabled: true,
                                title: "",
                                tag: "重要通知",
                                tagColor: "orange",
                                content: "",
                                items: [],
                                footerNote: "",
                            }}
                            onValuesChange={handleValuesChange}
                        >
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <Form.Item
                                    name="title"
                                    label="公告主标题"
                                    rules={[{ required: true, message: "请输入公告标题" }]}
                                    className="sm:col-span-2"
                                >
                                    <Input placeholder="例如：关于系统模型使用与画质设置的重要说明" />
                                </Form.Item>

                                <Form.Item
                                    name="tag"
                                    label="标签文本"
                                    rules={[{ required: true, message: "请输入标签文本" }]}
                                >
                                    <Input placeholder="例如：重要通知" />
                                </Form.Item>
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <Form.Item
                                    name="tagColor"
                                    label="标签颜色风格"
                                    rules={[{ required: true, message: "请选择标签颜色" }]}
                                    className="sm:col-span-1"
                                >
                                    <Select options={TAG_COLOR_OPTIONS} />
                                </Form.Item>

                                <Form.Item
                                    name="footerNote"
                                    label="底部说明 / 补充小字"
                                    className="sm:col-span-2"
                                >
                                    <Input placeholder="例如：ℹ️ 后续若上游开放更多画质档位，系统将第一时间更新。" />
                                </Form.Item>
                            </div>

                            <Form.Item
                                name="content"
                                label="公告前言 / 正文导语"
                            >
                                <Input.TextArea
                                    rows={3}
                                    placeholder="输入简要的前言背景说明（支持多行文本）"
                                />
                            </Form.Item>

                            <Divider className="!my-4">重点注意事项列表（多条目结构化配置）</Divider>

                            <Form.List name="items">
                                {(fields, { add, remove }) => (
                                    <div className="space-y-3">
                                        {fields.map(({ key, name, ...restField }) => (
                                            <div
                                                key={key}
                                                className="rounded-lg border border-stone-200 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/50 space-y-3"
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                                        <Form.Item
                                                            {...restField}
                                                            name={[name, "type"]}
                                                            label="条目类型"
                                                            className="!mb-0"
                                                            rules={[{ required: true, message: "请选择类型" }]}
                                                        >
                                                            <Select options={ITEM_TYPE_OPTIONS} />
                                                        </Form.Item>

                                                        <Form.Item
                                                            {...restField}
                                                            name={[name, "title"]}
                                                            label="条目标题"
                                                            className="!mb-0 sm:col-span-2"
                                                            rules={[{ required: true, message: "请输入条目标题" }]}
                                                        >
                                                            <Input placeholder="例如：最高画质支持 Medium（2K）：" />
                                                        </Form.Item>
                                                    </div>
                                                    <Button
                                                        type="text"
                                                        danger
                                                        icon={<Trash2 className="size-4" />}
                                                        onClick={() => {
                                                            remove(name);
                                                            syncPreviewFromForm();
                                                        }}
                                                        className="mt-6"
                                                    />
                                                </div>

                                                <Form.Item
                                                    {...restField}
                                                    name={[name, "description"]}
                                                    label="详细说明内容"
                                                    className="!mb-0"
                                                    rules={[{ required: true, message: "请输入详细说明" }]}
                                                >
                                                    <Input.TextArea
                                                        rows={2}
                                                        placeholder="例如：xAI 官方底层接口目前仅开放了 Medium（2K 高清）与 Low 档位..."
                                                    />
                                                </Form.Item>
                                            </div>
                                        ))}

                                        <Button
                                            type="dashed"
                                            onClick={() => {
                                                add({ type: "warning", title: "", description: "" });
                                                syncPreviewFromForm();
                                            }}
                                            block
                                            icon={<Plus className="size-4" />}
                                        >
                                            添加一条注意事项
                                        </Button>
                                    </div>
                                )}
                            </Form.List>
                        </Form>
                    </Card>
                </div>

                {/* Live Preview Section */}
                <div className="lg:col-span-5">
                    <Card
                        title={
                            <span className="flex items-center gap-2">
                                <Eye className="size-4 text-blue-500" />
                                客户端实时渲染预览
                            </span>
                        }
                        className="sticky top-20 shadow-xs"
                        extra={
                            <Button size="small" type="link" onClick={() => setRealModalOpen(true)}>
                                实机弹窗
                            </Button>
                        }
                    >
                        {!previewNotice.enabled && (
                            <Alert
                                message="当前系统公告已关闭"
                                description="在前台所有页面中将不会主动弹出公告，顶部通知图标也将隐藏或标记为已读。"
                                type="warning"
                                showIcon
                                className="mb-4"
                            />
                        )}

                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 dark:border-amber-500/25 dark:bg-amber-950/20 space-y-3">
                            <div className="flex items-center justify-between gap-2 border-b border-amber-500/15 pb-2.5">
                                <div className="flex items-center gap-1.5 font-semibold text-stone-900 dark:text-stone-100 text-sm">
                                    <Sparkles className="size-4 text-amber-500 shrink-0" />
                                    <span>{previewNotice.title || "（公告标题未填写）"}</span>
                                </div>
                                <Tag color={previewNotice.tagColor || "orange"} className="!m-0">
                                    {previewNotice.tag || "公告"}
                                </Tag>
                            </div>

                            {previewNotice.content && (
                                <p className="text-xs leading-relaxed text-stone-600 dark:text-stone-300 whitespace-pre-wrap">
                                    {previewNotice.content}
                                </p>
                            )}

                            {previewNotice.items && previewNotice.items.length > 0 && (
                                <div className="space-y-2 rounded-lg bg-background/80 p-3 shadow-xs">
                                    {previewNotice.items.map((item: NoticeItem, idx: number) => (
                                        <div key={idx} className="flex items-start gap-2 text-xs">
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

                            {previewNotice.footerNote && (
                                <p className="text-[11px] text-stone-400 dark:text-stone-500 whitespace-pre-wrap">
                                    {previewNotice.footerNote}
                                </p>
                            )}
                        </div>

                        <div className="mt-4 flex items-center justify-between text-xs text-stone-400 border-t pt-3">
                            <span>弹窗支持「今日不再弹出」免打扰</span>
                            <span className="text-emerald-600 font-medium">即时同步云端</span>
                        </div>
                    </Card>
                </div>
            </div>

            {/* Real Modal Preview Dialog */}
            <Modal
                open={realModalOpen}
                onCancel={() => setRealModalOpen(false)}
                centered
                width="min(640px, 94vw)"
                title={
                    <div className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
                        <span className="flex size-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                            <Megaphone className="size-4" />
                        </span>
                        <span className="truncate">全站系统公告</span>
                        {previewNotice.tag && (
                            <Tag color={previewNotice.tagColor || "orange"} className="!ml-1 !font-normal">
                                {previewNotice.tag}
                            </Tag>
                        )}
                    </div>
                }
                footer={
                    <div className="flex items-center justify-between border-t border-stone-200/60 pt-3 dark:border-stone-800/60">
                        <Checkbox checked={false} disabled className="text-xs text-stone-500 dark:text-stone-400">
                            今日不再弹出（效果演示）
                        </Checkbox>
                        <Button type="primary" onClick={() => setRealModalOpen(false)}>
                            我知道了
                        </Button>
                    </div>
                }
            >
                <div className="space-y-3.5 py-2 text-stone-700 dark:text-stone-300 max-h-[75vh] overflow-y-auto pr-1">
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 sm:p-4 dark:border-amber-500/25 dark:bg-amber-950/20">
                        <div className="flex items-center justify-between gap-2 border-b border-amber-500/15 pb-2.5">
                            <div className="flex items-center gap-1.5 font-semibold text-stone-900 dark:text-stone-100 text-sm">
                                <Sparkles className="size-4 text-amber-500 shrink-0" />
                                <span className="break-words">{previewNotice.title || "（公告标题未填写）"}</span>
                            </div>
                            {noticeDate && <span className="text-[11px] text-stone-400 shrink-0">{noticeDate}</span>}
                        </div>

                        <div className="mt-3 space-y-2.5 text-xs leading-relaxed">
                            {previewNotice.content && (
                                <p className="text-stone-600 dark:text-stone-300 whitespace-pre-wrap">
                                    {previewNotice.content}
                                </p>
                            )}

                            {previewNotice.items && previewNotice.items.length > 0 && (
                                <div className="space-y-2 rounded-lg bg-background/70 p-3 shadow-xs">
                                    {previewNotice.items.map((item: NoticeItem, idx: number) => (
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

                            {previewNotice.footerNote && (
                                <p className="text-[11px] text-stone-400 dark:text-stone-500 whitespace-pre-wrap">
                                    {previewNotice.footerNote}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
