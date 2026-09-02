import { useEffect, useState } from "react";
import {
    Card,
    Form,
    Input,
    Select,
    Button,
    Alert,
    Space,
    Tag,
    Divider,
    Modal,
    Checkbox,
    Tooltip,
    message,
    InputNumber,
    Collapse,
    Badge,
} from "antd";
import {
    Sparkles,
    Key,
    Radio,
    CheckCircle,
    XCircle,
    Globe,
    DownloadCloud,
    Zap,
    Plus,
    Layers,
    Sliders,
    HelpCircle,
    Server,
    Clock,
} from "lucide-react";
import type {
    AiConfig,
    UpdateAiConfigPayload,
    TestAiConfigPayload,
    TestAiConfigResponse,
} from "@/services/api/admin";
import { fetchAdminUpstreamModels, type FetchModelsResponse } from "@/services/api/admin";

type AdminAiConfigPanelProps = {
    aiConfig: AiConfig | null;
    loading: boolean;
    saving: boolean;
    testLoading: boolean;
    testResult: TestAiConfigResponse | null;
    onSave: (payload: UpdateAiConfigPayload) => Promise<boolean>;
    onTest: (payload: TestAiConfigPayload) => Promise<TestAiConfigResponse | null>;
    onClearTestResult: () => void;
};

// Common Provider Presets
const PROVIDER_PRESETS = [
    {
        name: "OpenAI 官方",
        baseUrl: "https://api.openai.com/v1",
        imageModels: ["dall-e-3", "dall-e-2"],
        defaultModel: "dall-e-3",
        chatModels: ["gpt-4o", "gpt-4o-mini"],
        tag: "官方",
    },
    {
        name: "SiliconFlow (硅基流动)",
        baseUrl: "https://api.siliconflow.cn/v1",
        imageModels: [
            "black-forest-labs/FLUX.1-dev",
            "black-forest-labs/FLUX.1-schnell",
            "stabilityai/stable-diffusion-3-5-large",
        ],
        defaultModel: "black-forest-labs/FLUX.1-dev",
        chatModels: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
        tag: "国内高速",
    },
    {
        name: "Infistar (无限星河)",
        baseUrl: "https://api.infistar.ai/v1",
        imageModels: ["flux-1.1-pro", "flux-dev", "midjourney-v6", "dall-e-3"],
        defaultModel: "flux-dev",
        chatModels: ["gpt-4o", "claude-3-5-sonnet-20241022", "deepseek-chat"],
        tag: "全模态中转",
    },
    {
        name: "Atlas Cloud",
        baseUrl: "https://api.atlascloud.ai/v1",
        imageModels: ["flux-pro", "flux-dev", "dall-e-3", "midjourney"],
        defaultModel: "flux-pro",
        chatModels: ["gpt-4o", "claude-3-5-sonnet"],
        tag: "高性价比",
    },
    {
        name: "DeepSeek 官方",
        baseUrl: "https://api.deepseek.com/v1",
        imageModels: [],
        defaultModel: "",
        chatModels: ["deepseek-chat", "deepseek-reasoner"],
        tag: "大模型",
    },
    {
        name: "OneAPI / NewAPI / 自建网关",
        baseUrl: "https://your-domain.com/v1",
        imageModels: ["dall-e-3", "flux-dev", "midjourney"],
        defaultModel: "dall-e-3",
        chatModels: ["gpt-4o", "claude-3-5-sonnet-20241022"],
        tag: "自建中转",
    },
];

// Curated Popular Models for Quick Add
const CURATED_IMAGE_MODELS = [
    { id: "dall-e-3", label: "DALL-E 3 (OpenAI 旗舰)", group: "OpenAI" },
    { id: "black-forest-labs/FLUX.1-dev", label: "FLUX.1-dev (硅基流动/官方)", group: "FLUX" },
    { id: "black-forest-labs/FLUX.1-schnell", label: "FLUX.1-schnell (极速)", group: "FLUX" },
    { id: "flux-pro", label: "flux-pro (高画质中转)", group: "FLUX" },
    { id: "flux-dev", label: "flux-dev (标准中转)", group: "FLUX" },
    { id: "midjourney", label: "Midjourney (MJ 代理)", group: "Midjourney" },
    { id: "midjourney-v6", label: "Midjourney V6", group: "Midjourney" },
    { id: "stabilityai/stable-diffusion-3-5-large", label: "SD 3.5 Large", group: "Stability" },
    { id: "recraft-v3", label: "Recraft V3", group: "Recraft" },
    { id: "ideogram/v2", label: "Ideogram V2", group: "Ideogram" },
];

const CURATED_CHAT_MODELS = [
    { id: "gpt-4o", label: "GPT-4o (全能多模态)", group: "OpenAI" },
    { id: "gpt-4o-mini", label: "GPT-4o mini (快速低成本)", group: "OpenAI" },
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", group: "Anthropic" },
    { id: "deepseek-chat", label: "DeepSeek-V3", group: "DeepSeek" },
    { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek-V3 (硅基流动)", group: "DeepSeek" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", group: "Google" },
];

export function AdminAiConfigPanel({
    aiConfig,
    loading,
    saving,
    testLoading,
    testResult,
    onSave,
    onTest,
    onClearTestResult,
}: AdminAiConfigPanelProps) {
    const [form] = Form.useForm();
    const [imageModelsList, setImageModelsList] = useState<string[]>([]);
    const [chatModelsList, setChatModelsList] = useState<string[]>([]);

    // Upstream model discovery state
    const [fetchLoading, setFetchLoading] = useState(false);
    const [modelDiscoveryModalOpen, setModelDiscoveryModalOpen] = useState(false);
    const [discoveredModels, setDiscoveredModels] = useState<FetchModelsResponse | null>(null);
    const [selectedDiscoveredImage, setSelectedDiscoveredImage] = useState<string[]>([]);
    const [selectedDiscoveredChat, setSelectedDiscoveredChat] = useState<string[]>([]);

    useEffect(() => {
        if (aiConfig) {
            const imageModels = aiConfig.imageModels && aiConfig.imageModels.length > 0
                ? aiConfig.imageModels
                : ["dall-e-3", "gpt-image-2"];
            const chatModels = aiConfig.chatModels && aiConfig.chatModels.length > 0
                ? aiConfig.chatModels
                : ["gpt-4o", "gpt-4o-mini"];

            setImageModelsList(imageModels);
            setChatModelsList(chatModels);

            form.setFieldsValue({
                baseUrl: aiConfig.baseUrl || "https://api.openai.com/v1",
                apiKey: "",
                imageModels,
                defaultModel: aiConfig.defaultModel || imageModels[0] || "dall-e-3",
                chatModels,
                timeoutMs: (aiConfig as any).timeoutMs || 300000,
            });
            onClearTestResult();
        }
    }, [aiConfig, form, onClearTestResult]);

    const handleApplyPreset = (preset: typeof PROVIDER_PRESETS[0]) => {
        form.setFieldsValue({
            baseUrl: preset.baseUrl,
            imageModels: preset.imageModels.length > 0 ? preset.imageModels : form.getFieldValue("imageModels"),
            defaultModel: preset.defaultModel || form.getFieldValue("defaultModel"),
            chatModels: preset.chatModels.length > 0 ? preset.chatModels : form.getFieldValue("chatModels"),
        });
        if (preset.imageModels.length > 0) {
            setImageModelsList(preset.imageModels);
        }
        if (preset.chatModels.length > 0) {
            setChatModelsList(preset.chatModels);
        }
        message.success(`已应用 ${preset.name} 预设参数，请填入对应的 API Key 后点击测试或保存`);
    };

    const handleQuickAddImageModel = (modelId: string) => {
        const current = form.getFieldValue("imageModels") || [];
        if (!current.includes(modelId)) {
            const next = [...current, modelId];
            form.setFieldValue("imageModels", next);
            setImageModelsList(next);
            if (!form.getFieldValue("defaultModel")) {
                form.setFieldValue("defaultModel", modelId);
            }
            message.info(`已添加生图模型: ${modelId}`);
        }
    };

    const handleQuickAddChatModel = (modelId: string) => {
        const current = form.getFieldValue("chatModels") || [];
        if (!current.includes(modelId)) {
            const next = [...current, modelId];
            form.setFieldValue("chatModels", next);
            setChatModelsList(next);
            message.info(`已添加对话模型: ${modelId}`);
        }
    };

    const handleFetchUpstreamModels = async () => {
        try {
            const values = form.getFieldsValue();
            const baseUrl = values.baseUrl?.trim();
            if (!baseUrl) {
                message.warning("请先填写 API Base URL");
                return;
            }

            setFetchLoading(true);
            const res = await fetchAdminUpstreamModels({
                baseUrl,
                apiKey: values.apiKey?.trim() || undefined,
            });

            if (res.success && res.allModels?.length > 0) {
                setDiscoveredModels(res);
                setSelectedDiscoveredImage(res.imageModels || []);
                setSelectedDiscoveredChat(res.chatModels || []);
                setModelDiscoveryModalOpen(true);
                message.success(`成功从上游检测到 ${res.total} 个可用模型！`);
            } else {
                message.error(res.message || "未能从上游获取到模型列表，请确认 Base URL 与 API Key 正确有效");
            }
        } catch (err: any) {
            message.error(err.response?.data?.message || err.message || "拉取模型列表失败");
        } finally {
            setFetchLoading(false);
        }
    };

    const handleImportDiscoveredModels = () => {
        if (!discoveredModels) return;

        const currentImages = form.getFieldValue("imageModels") || [];
        const currentChats = form.getFieldValue("chatModels") || [];

        const mergedImages = Array.from(new Set([...currentImages, ...selectedDiscoveredImage]));
        const mergedChats = Array.from(new Set([...currentChats, ...selectedDiscoveredChat]));

        form.setFieldsValue({
            imageModels: mergedImages,
            chatModels: mergedChats,
        });
        setImageModelsList(mergedImages);
        setChatModelsList(mergedChats);

        if (mergedImages.length > 0 && !mergedImages.includes(form.getFieldValue("defaultModel"))) {
            form.setFieldValue("defaultModel", mergedImages[0]);
        }

        setModelDiscoveryModalOpen(false);
        message.success(`成功导入 ${selectedDiscoveredImage.length} 个生图模型与 ${selectedDiscoveredChat.length} 个对话模型`);
    };

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            await onSave({
                baseUrl: values.baseUrl.trim(),
                apiKey: values.apiKey?.trim() ? values.apiKey.trim() : undefined,
                imageModels: values.imageModels || [],
                defaultModel: values.defaultModel,
                chatModels: values.chatModels || [],
                timeoutMs: values.timeoutMs,
            });
        } catch {}
    };

    const handleTest = async () => {
        try {
            const values = form.getFieldsValue();
            await onTest({
                baseUrl: values.baseUrl?.trim() || undefined,
                apiKey: values.apiKey?.trim() || undefined,
            });
        } catch {}
    };

    const hasConfiguredKey = aiConfig?.hasKey ?? aiConfig?.hasApiKey ?? Boolean(aiConfig?.apiKeyMasked);

    return (
        <div className="space-y-6">
            {/* Header & Quick Status */}
            <Card className="border border-stone-200/80 shadow-xs dark:border-stone-800">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                <Sparkles className="size-5" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg font-bold text-stone-950 dark:text-stone-100">
                                        AI 模型与服务渠道配置
                                    </h2>
                                    <Tag color={hasConfiguredKey ? "green" : "orange"} className="!mr-0">
                                        {hasConfiguredKey ? "API Key 已就绪" : "未配置密钥"}
                                    </Tag>
                                </div>
                                <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                                    统一管理 OpenAI 标准及兼容接口（支持各类中转站、Flux、DALL-E、Midjourney 等），密钥服务端隔离防泄露。
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 self-start md:self-auto">
                        <Button
                            icon={<DownloadCloud className={`size-4 ${fetchLoading ? "animate-bounce" : ""}`} />}
                            onClick={handleFetchUpstreamModels}
                            loading={fetchLoading}
                            className="!font-medium"
                        >
                            从上游拉取模型
                        </Button>
                        <Button
                            icon={<Radio className={`size-4 ${testLoading ? "animate-pulse text-amber-500" : ""}`} />}
                            onClick={handleTest}
                            loading={testLoading}
                        >
                            测试连通性
                        </Button>
                    </div>
                </div>

                {/* Quick Provider Presets Bar */}
                <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800/80">
                    <div className="flex items-center gap-2 mb-2.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
                        <Zap className="size-3.5 text-amber-500" />
                        <span>快速应用主流渠道预设：</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {PROVIDER_PRESETS.map((preset) => (
                            <button
                                key={preset.name}
                                type="button"
                                onClick={() => handleApplyPreset(preset)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-stone-200 bg-stone-50/80 text-stone-700 transition hover:bg-stone-100 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-300 dark:hover:bg-stone-800"
                            >
                                <span className="font-medium">{preset.name}</span>
                                <span className="text-[10px] opacity-60 bg-black/5 dark:bg-white/10 px-1 rounded">
                                    {preset.tag}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </Card>

            {/* Test Result Alert */}
            {testResult && (
                <div>
                    {testResult.success ? (
                        <Alert
                            type="success"
                            showIcon
                            icon={<CheckCircle className="size-4 text-emerald-600" />}
                            message={
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold">AI 服务连通诊断成功</span>
                                    {testResult.latencyMs !== undefined && (
                                        <Badge
                                            count={`${testResult.latencyMs} ms`}
                                            style={{
                                                backgroundColor:
                                                    testResult.latencyMs < 500
                                                        ? "#10b981"
                                                        : testResult.latencyMs < 1500
                                                        ? "#f59e0b"
                                                        : "#ef4444",
                                            }}
                                        />
                                    )}
                                </div>
                            }
                            description={
                                <div className="text-xs space-y-1 mt-1">
                                    <p>{testResult.message || "上游 API 响应正常，所有生图与对话代理接口均可正常使用。"}</p>
                                </div>
                            }
                            closable
                            onClose={onClearTestResult}
                        />
                    ) : (
                        <Alert
                            type="error"
                            showIcon
                            icon={<XCircle className="size-4 text-rose-600" />}
                            message="AI 服务连通测试失败"
                            description={
                                <div className="text-xs space-y-1 mt-1">
                                    <p className="font-medium text-rose-700 dark:text-rose-400">
                                        {testResult.message || "未能成功连接至上游 API"}
                                    </p>
                                    <p className="text-stone-500">
                                        排查建议：请核对 Base URL 是否包含完整路径（如 /v1）、API Key 是否正确、或是否存在跨域/中转站额度不足限制。
                                    </p>
                                </div>
                            }
                            closable
                            onClose={onClearTestResult}
                        />
                    )}
                </div>
            )}

            {/* Main Configuration Form */}
            <Card className="border border-stone-200/80 shadow-xs dark:border-stone-800">
                <Form
                    form={form}
                    layout="vertical"
                    requiredMark={false}
                    className="max-w-4xl space-y-6"
                >
                    {/* Section 1: Connection & Credentials */}
                    <div>
                        <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2 mb-4 pb-2 border-b border-stone-100 dark:border-stone-800">
                            <Server className="size-4 text-stone-500" />
                            1. 基础服务地址与认证凭据
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Form.Item
                                name="baseUrl"
                                label={
                                    <span className="font-medium flex items-center gap-1.5">
                                        API 接口基础地址 (Base URL)
                                        <Tooltip title="支持 OpenAI 官方或任何 OpenAI 兼容中转站、网关、自建服务地址">
                                            <HelpCircle className="size-3.5 text-stone-400" />
                                        </Tooltip>
                                    </span>
                                }
                                rules={[
                                    { required: true, message: "请输入 API Base URL" },
                                    { type: "url", message: "请输入合法的 URL 地址 (如 https://api.openai.com/v1)" },
                                ]}
                            >
                                <Input
                                    prefix={<Globe className="size-4 text-stone-400" />}
                                    placeholder="https://api.openai.com/v1"
                                    className="!rounded-lg"
                                />
                            </Form.Item>

                            <Form.Item
                                name="apiKey"
                                label={
                                    <span className="font-medium flex items-center gap-1.5">
                                        服务端 API Key
                                        <span className="text-xs font-normal text-stone-400">
                                            ({hasConfiguredKey ? "已配置，留空沿用" : "必填"})
                                        </span>
                                    </span>
                                }
                            >
                                <Input.Password
                                    prefix={<Key className="size-4 text-stone-400" />}
                                    placeholder={
                                        hasConfiguredKey
                                            ? `已配置 (${aiConfig?.apiKeyMasked || "sk-****"})，输入新值可覆盖`
                                            : "请输入 API Key (sk-...)"
                                    }
                                    autoComplete="off"
                                    className="!rounded-lg"
                                />
                            </Form.Item>
                        </div>
                    </div>

                    {/* Section 2: Image Generation Models */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                                <Sparkles className="size-4 text-amber-500" />
                                2. 支持的生图模型列表 (Image Models)
                            </h3>
                            <span className="text-xs text-stone-400">
                                当前已启用 {imageModelsList.length} 个生图模型
                            </span>
                        </div>

                        {/* Quick Add Chips for Image Models */}
                        <div className="p-3 rounded-xl bg-stone-50/80 border border-stone-200/70 dark:bg-stone-900/40 dark:border-stone-800/80 mb-3">
                            <div className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2 flex items-center gap-1">
                                <Plus className="size-3 text-amber-500" />
                                热门生图模型一键添加：
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {CURATED_IMAGE_MODELS.map((m) => {
                                    const isAdded = imageModelsList.includes(m.id);
                                    return (
                                        <button
                                            key={m.id}
                                            type="button"
                                            disabled={isAdded}
                                            onClick={() => handleQuickAddImageModel(m.id)}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition ${
                                                isAdded
                                                    ? "bg-stone-200/60 text-stone-400 dark:bg-stone-800/60 dark:text-stone-500 cursor-default"
                                                    : "bg-white text-stone-700 border border-stone-200 hover:border-amber-400 hover:text-amber-600 shadow-2xs dark:bg-stone-800 dark:text-stone-200 dark:border-stone-700"
                                            }`}
                                        >
                                            {isAdded ? "✓" : "+"}
                                            <span>{m.id}</span>
                                            <span className="text-[10px] opacity-50">({m.group})</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <Form.Item
                            name="imageModels"
                            rules={[{ required: true, message: "请至少配置一个生图模型" }]}
                            extra="输入自定义模型名称后按回车即可加入列表；前端画布生图工具将展示此列表中的模型"
                        >
                            <Select
                                mode="tags"
                                placeholder="输入或选择生图模型（支持自定义 tags）"
                                value={imageModelsList}
                                onChange={(vals) => {
                                    setImageModelsList(vals);
                                    const curDefault = form.getFieldValue("defaultModel");
                                    if (!vals.includes(curDefault)) {
                                        form.setFieldValue("defaultModel", vals[0] || "");
                                    }
                                }}
                                className="!w-full"
                            />
                        </Form.Item>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                            <Form.Item
                                name="defaultModel"
                                label={<span className="font-medium">默认生图模型 (Default Image Model)</span>}
                                rules={[{ required: true, message: "请指定默认生图模型" }]}
                                extra="画板新建图片节点时预选的生图模型"
                            >
                                <Select
                                    placeholder="请选择默认生图模型"
                                    options={imageModelsList.map((m) => ({ label: `🌟 ${m}`, value: m }))}
                                    className="!w-full"
                                />
                            </Form.Item>
                        </div>
                    </div>

                    {/* Section 3: Chat / Agent Models */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                                <Layers className="size-4 text-blue-500" />
                                3. 对话与 Agent 助手模型列表 (Chat Models)
                            </h3>
                            <span className="text-xs text-stone-400">
                                当前已启用 {chatModelsList.length} 个对话模型
                            </span>
                        </div>

                        {/* Quick Add Chips for Chat Models */}
                        <div className="p-3 rounded-xl bg-stone-50/80 border border-stone-200/70 dark:bg-stone-900/40 dark:border-stone-800/80 mb-3">
                            <div className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2 flex items-center gap-1">
                                <Plus className="size-3 text-blue-500" />
                                热门对话/多模态模型一键添加：
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {CURATED_CHAT_MODELS.map((m) => {
                                    const isAdded = chatModelsList.includes(m.id);
                                    return (
                                        <button
                                            key={m.id}
                                            type="button"
                                            disabled={isAdded}
                                            onClick={() => handleQuickAddChatModel(m.id)}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition ${
                                                isAdded
                                                    ? "bg-stone-200/60 text-stone-400 dark:bg-stone-800/60 dark:text-stone-500 cursor-default"
                                                    : "bg-white text-stone-700 border border-stone-200 hover:border-blue-400 hover:text-blue-600 shadow-2xs dark:bg-stone-800 dark:text-stone-200 dark:border-stone-700"
                                            }`}
                                        >
                                            {isAdded ? "✓" : "+"}
                                            <span>{m.id}</span>
                                            <span className="text-[10px] opacity-50">({m.group})</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <Form.Item
                            name="chatModels"
                            extra="用于画布 Agent 对话助手与提示词智能润色功能"
                        >
                            <Select
                                mode="tags"
                                placeholder="输入或选择对话模型"
                                value={chatModelsList}
                                onChange={(vals) => setChatModelsList(vals)}
                                className="!w-full"
                            />
                        </Form.Item>
                    </div>

                    {/* Section 4: Advanced Network Options */}
                    <Collapse
                        ghost
                        items={[
                            {
                                key: "advanced",
                                label: (
                                    <span className="text-xs font-semibold text-stone-500 flex items-center gap-1.5">
                                        <Sliders className="size-3.5" />
                                        高级参数配置 (超时时间与网络代理)
                                    </span>
                                ),
                                children: (
                                    <div className="pt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <Form.Item
                                            name="timeoutMs"
                                            label={<span className="text-xs">请求超时时间 (毫秒)</span>}
                                            extra="生图任务较耗时，建议 180000ms (3分钟) 或以上"
                                        >
                                            <InputNumber
                                                min={5000}
                                                max={600000}
                                                step={5000}
                                                className="!w-full"
                                                addonAfter="ms"
                                            />
                                        </Form.Item>
                                    </div>
                                ),
                            },
                        ]}
                    />

                    {/* Actions */}
                    <div className="pt-6 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between">
                        <Space size="middle">
                            <Button
                                type="primary"
                                size="large"
                                onClick={handleSave}
                                loading={saving}
                                className="!px-8 !font-semibold !rounded-xl"
                            >
                                保存 AI 配置
                            </Button>
                            <Button
                                size="large"
                                icon={<Radio className={`size-4 ${testLoading ? "animate-pulse" : ""}`} />}
                                onClick={handleTest}
                                loading={testLoading}
                                className="!rounded-xl"
                            >
                                测试连接
                            </Button>
                        </Space>

                        <span className="text-xs text-stone-400">
                            修改保存后将立即在所有用户的画板中生效
                        </span>
                    </div>
                </Form>
            </Card>

            {/* Model Discovery Modal */}
            <Modal
                title={
                    <div className="flex items-center gap-2">
                        <DownloadCloud className="size-5 text-amber-500" />
                        <span>上游模型自动发现与导入</span>
                    </div>
                }
                open={modelDiscoveryModalOpen}
                onCancel={() => setModelDiscoveryModalOpen(false)}
                onOk={handleImportDiscoveredModels}
                okText={`导入选中的模型 (${selectedDiscoveredImage.length + selectedDiscoveredChat.length})`}
                cancelText="取消"
                width={720}
                centered
            >
                {discoveredModels && (
                    <div className="space-y-4 py-2">
                        <Alert
                            type="info"
                            showIcon
                            message={`共检测到 ${discoveredModels.total} 个可用模型 (耗时 ${discoveredModels.latencyMs || 0}ms)`}
                            description="已按模型名称自动为您智能归类生图模型与对话模型，您可以按需勾选并一键导入到配置中。"
                        />

                        {/* Image Models Category */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-sm text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                                    <Sparkles className="size-4 text-amber-500" />
                                    生图模型 ({discoveredModels.imageModels.length})
                                </span>
                                <Button
                                    type="link"
                                    size="small"
                                    onClick={() => {
                                        if (selectedDiscoveredImage.length === discoveredModels.imageModels.length) {
                                            setSelectedDiscoveredImage([]);
                                        } else {
                                            setSelectedDiscoveredImage([...discoveredModels.imageModels]);
                                        }
                                    }}
                                >
                                    {selectedDiscoveredImage.length === discoveredModels.imageModels.length ? "取消全选" : "全选生图模型"}
                                </Button>
                            </div>
                            <div className="max-h-48 overflow-y-auto p-3 rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/50 space-y-1">
                                {discoveredModels.imageModels.length === 0 ? (
                                    <div className="text-xs text-stone-400 py-2 text-center">未自动匹配到生图模型，请在下方其他模型中寻找并添加</div>
                                ) : (
                                    <Checkbox.Group
                                        value={selectedDiscoveredImage}
                                        onChange={(vals) => setSelectedDiscoveredImage(vals as string[])}
                                        className="!flex !flex-col !gap-2"
                                    >
                                        {discoveredModels.imageModels.map((m) => (
                                            <Checkbox key={m} value={m} className="!text-xs">
                                                <span className="font-medium">{m}</span>
                                            </Checkbox>
                                        ))}
                                    </Checkbox.Group>
                                )}
                            </div>
                        </div>

                        {/* Chat Models Category */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-sm text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                                    <Layers className="size-4 text-blue-500" />
                                    对话与多模态模型 ({discoveredModels.chatModels.length})
                                </span>
                                <Button
                                    type="link"
                                    size="small"
                                    onClick={() => {
                                        if (selectedDiscoveredChat.length === discoveredModels.chatModels.length) {
                                            setSelectedDiscoveredChat([]);
                                        } else {
                                            setSelectedDiscoveredChat([...discoveredModels.chatModels]);
                                        }
                                    }}
                                >
                                    {selectedDiscoveredChat.length === discoveredModels.chatModels.length ? "取消全选" : "全选对话模型"}
                                </Button>
                            </div>
                            <div className="max-h-48 overflow-y-auto p-3 rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/50 space-y-1">
                                {discoveredModels.chatModels.length === 0 ? (
                                    <div className="text-xs text-stone-400 py-2 text-center">未匹配到对话模型</div>
                                ) : (
                                    <Checkbox.Group
                                        value={selectedDiscoveredChat}
                                        onChange={(vals) => setSelectedDiscoveredChat(vals as string[])}
                                        className="!flex !flex-col !gap-2"
                                    >
                                        {discoveredModels.chatModels.map((m) => (
                                            <Checkbox key={m} value={m} className="!text-xs">
                                                <span className="font-medium">{m}</span>
                                            </Checkbox>
                                        ))}
                                    </Checkbox.Group>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
