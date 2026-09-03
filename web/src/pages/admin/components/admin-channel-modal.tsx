import { useEffect, useState } from "react";
import { Modal, Form, Input, InputNumber, Switch, Select, Button, message } from "antd";
import { RotateCw } from "lucide-react";
import type { AdminChannelItem, CreateChannelPayload, UpdateChannelPayload } from "@/services/api/admin";
import { fetchAdminUpstreamModels } from "@/services/api/admin";

interface AdminChannelModalProps {
    open: boolean;
    channel: AdminChannelItem | null;
    onCancel: () => void;
    onSubmit: (payload: CreateChannelPayload | UpdateChannelPayload) => Promise<boolean>;
}

const PROVIDER_OPTIONS = [
    { label: "OpenAI 官方协议", value: "openai" },
    { label: "SiliconFlow (硅基流动)", value: "siliconflow" },
    { label: "DeepSeek (深度求索)", value: "deepseek" },
    { label: "Anthropic / Claude", value: "anthropic" },
    { label: "Gemini 官方协议", value: "gemini" },
    { label: "OneAPI / NewAPI / 自建中转", value: "oneapi" },
    { label: "自定义兼容服务商", value: "custom" },
];

export function AdminChannelModal({ open, channel, onCancel, onSubmit }: AdminChannelModalProps) {
    const [form] = Form.useForm();
    const [submitting, setSubmitting] = useState(false);
    const [fetchingModels, setFetchingModels] = useState(false);

    useEffect(() => {
        if (open) {
            if (channel) {
                form.setFieldsValue({
                    name: channel.name,
                    providerType: channel.providerType || "openai",
                    baseUrl: channel.baseUrl,
                    apiKey: "",
                    priority: channel.priority ?? 0,
                    weight: channel.weight ?? 1,
                    isActive: channel.isActive ?? true,
                    models: channel.models || [],
                    defaultModel: channel.defaultModel || undefined,
                    timeoutMs: channel.timeoutMs || 300000,
                });
            } else {
                form.resetFields();
                form.setFieldsValue({
                    providerType: "openai",
                    priority: 0,
                    weight: 1,
                    isActive: true,
                    models: [],
                    timeoutMs: 300000,
                });
            }
        }
    }, [open, channel, form]);

    const handleFetchModels = async () => {
        const baseUrl = form.getFieldValue("baseUrl");
        const apiKey = form.getFieldValue("apiKey");

        if (!baseUrl) {
            message.warning("请先输入渠道 Base URL");
            return;
        }

        try {
            setFetchingModels(true);
            const res = await fetchAdminUpstreamModels({
                baseUrl,
                apiKey: apiKey || (channel?.hasApiKey ? "RETAIN_EXISTING" : undefined),
            });

            if (res.allModels && res.allModels.length > 0) {
                const currentModels = form.getFieldValue("models") || [];
                const merged = Array.from(new Set([...currentModels, ...res.allModels]));
                form.setFieldsValue({ models: merged });
                message.success(`成功探测获取 ${res.allModels.length} 个模型`);
            } else {
                message.info("未从上游接口探测到模型");
            }
        } catch (err: any) {
            const msg = err.response?.data?.message || err.message || "拉取模型列表失败";
            message.error(msg);
        } finally {
            setFetchingModels(false);
        }
    };

    const handleFinish = async (values: any) => {
        try {
            setSubmitting(true);
            const payload: any = {
                name: values.name.trim(),
                providerType: values.providerType,
                baseUrl: values.baseUrl.trim(),
                priority: values.priority ?? 0,
                weight: values.weight ?? 1,
                isActive: Boolean(values.isActive),
                models: values.models || [],
                defaultModel: values.defaultModel?.trim() || undefined,
                timeoutMs: values.timeoutMs || 300000,
            };

            if (values.apiKey && values.apiKey.trim()) {
                payload.apiKey = values.apiKey.trim();
            }

            const success = await onSubmit(payload);
            if (success) {
                onCancel();
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            title={channel ? "编辑 AI 模型渠道" : "新增 AI 模型渠道"}
            open={open}
            onCancel={onCancel}
            onOk={() => form.submit()}
            confirmLoading={submitting}
            destroyOnClose
            width={640}
        >
            <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark="optional">
                <Form.Item
                    name="name"
                    label="渠道名称"
                    rules={[{ required: true, message: "请输入渠道直观名称" }]}
                >
                    <Input placeholder="例如：SiliconFlow 高速渠道 / OpenAI 官方" />
                </Form.Item>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Form.Item name="providerType" label="服务商协议类型">
                        <Select options={PROVIDER_OPTIONS} />
                    </Form.Item>

                    <Form.Item name="isActive" label="渠道状态" valuePropName="checked">
                        <Switch checkedChildren="已启用" unCheckedChildren="已停用" />
                    </Form.Item>
                </div>

                <Form.Item
                    name="baseUrl"
                    label="接口 Base URL"
                    rules={[
                        { required: true, message: "请输入接口 Base URL" },
                        { type: "url", message: "必须是合法的 URL 格式" },
                    ]}
                >
                    <Input placeholder="例如：https://api.siliconflow.cn/v1" />
                </Form.Item>

                <Form.Item
                    name="apiKey"
                    label={channel?.hasApiKey ? "API Key（留空则保持既有秘钥）" : "API Key"}
                    rules={[{ required: !channel?.hasApiKey, message: "请输入渠道 API Key" }]}
                >
                    <Input.Password placeholder={channel?.apiKeyMasked || "sk-..."} />
                </Form.Item>

                <Form.Item
                    name="models"
                    label={
                        <div className="flex w-full items-center justify-between">
                            <span>支持与绑定的模型列表</span>
                            <Button
                                size="small"
                                type="link"
                                icon={<RotateCw className={`size-3 ${fetchingModels ? "animate-spin" : ""}`} />}
                                onClick={handleFetchModels}
                                loading={fetchingModels}
                            >
                                上游模型探测
                            </Button>
                        </div>
                    }
                >
                    <Select
                        mode="tags"
                        placeholder="输入模型名称按回车添加，或点击探测"
                        style={{ width: "100%" }}
                        tokenSeparators={[",", " "]}
                        maxTagCount="responsive"
                    />
                </Form.Item>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Form.Item name="defaultModel" label="默认模型（可选）">
                        <Input placeholder="如 dall-e-3" />
                    </Form.Item>

                    <Form.Item name="priority" label="调度优先级">
                        <InputNumber min={-100} max={100} className="w-full" placeholder="越大越优先" />
                    </Form.Item>

                    <Form.Item name="weight" label="轮询权重">
                        <InputNumber min={1} max={100} className="w-full" placeholder="1-100" />
                    </Form.Item>
                </div>
            </Form>
        </Modal>
    );
}
