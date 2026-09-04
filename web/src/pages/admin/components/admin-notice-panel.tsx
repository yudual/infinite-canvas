import { useState, useEffect } from "react";
import {
    Card,
    Form,
    Input,
    Switch,
    Button,
    Select,
    Tag,
    Space,
    App,
    Divider,
    Alert,
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
    CheckCircle2,
    Lightbulb,
    AlertCircle,
    Info,
} from "lucide-react";
import {
    getAdminNotice,
    updateAdminNotice,
    type SystemNoticeConfig,
    type NoticeItem,
} from "@/services/api/admin";
import { useNoticeStore } from "@/stores/use-notice-store";

const DEFAULT_GROK_NOTICE: Partial<SystemNoticeConfig> = {
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
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
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
        setPreviewNotice({ ...allValues });
    };

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            setSaving(true);
            const res = await updateAdminNotice(values);
            if (res.success) {
                message.success(res.message || "系统公告保存成功，所有用户端已即刻生效");
                setPreviewNotice(res.notice);
                // Refresh client notice store
                void fetchPublicNotice();
            }
        } catch (err: any) {
            if (err.errorFields) return;
            message.error(err.message || "保存系统公告失败");
        } finally {
            setSaving(false);
        }
    };

    const handleResetGrokTemplate = () => {
        form.setFieldsValue(DEFAULT_GROK_NOTICE);
        setPreviewNotice(DEFAULT_GROK_NOTICE);
        message.info("已填入 Grok 2.0 默认公告模板，点击保存即可发布");
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100 flex items-center gap-2">
                        <Megaphone className="size-5 text-amber-500" />
                        全站系统公告配置
                    </h2>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                        在此可自定义全站弹窗公告的标题、正文、注意事项列表及展示开关，修改后全平台用户即刻同步生效。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        icon={<RotateCw className={`size-4 ${loading ? "animate-spin" : ""}`} />}
                        onClick={loadNotice}
                        disabled={loading}
                    >
                        重新加载
                    </Button>
                    <Button onClick={handleResetGrokTemplate}>
                        重置为 Grok 说明模板
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
                                                        onClick={() => remove(name)}
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
                                            onClick={() => add({ type: "warning", title: "", description: "" })}
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
        </div>
    );
}
