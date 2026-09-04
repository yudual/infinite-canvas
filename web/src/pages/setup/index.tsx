import { useState, useEffect } from "react";
import { App, Button, Form, Input } from "antd";
import { Lock, Smile, Sparkles, User as UserIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { initSetup } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

export default function SetupPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const { requiresSetup, loading, setSession } = useUserStore();

    useEffect(() => {
        if (!loading && requiresSetup === false) {
            navigate("/login", { replace: true });
        }
    }, [loading, requiresSetup, navigate]);

    const handleSubmit = async (values: { username: string; password: string; confirmPassword: string; displayName?: string }) => {
        try {
            setSubmitting(true);
            const res = await initSetup({
                username: values.username.trim(),
                password: values.password,
                displayName: values.displayName?.trim() || values.username.trim(),
            });
            message.success("系统初始化成功，欢迎使用！");
            setSession(res.token, res.user);
            navigate("/", { replace: true });
        } catch (error: any) {
            const errorMsg = error.response?.data?.message || error.response?.data?.error?.message || error.message || "初始化失败，请稍后重试";
            message.error(errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="relative flex min-h-screen w-full items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] px-4 py-12 text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white/80 p-8 shadow-xl backdrop-blur-xl dark:border-stone-800 dark:bg-stone-900/80">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950">
                        <Sparkles className="size-6" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-stone-950 dark:text-stone-100">初始化系统配置</h1>
                    <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">检测到系统首次运行，请创建首个超级管理员账户以开启 Yu-canvas</p>
                </div>

                <Form layout="vertical" onFinish={handleSubmit} requiredMark={false} size="large">
                    <Form.Item
                        name="username"
                        label="管理员账号"
                        rules={[
                            { required: true, message: "请输入管理员账号" },
                            { min: 3, max: 32, message: "账号长度需在 3-32 位之间" },
                            { pattern: /^[a-zA-Z0-9_-]+$/, message: "账号仅支持字母、数字、下划线及连字符" },
                        ]}
                    >
                        <Input prefix={<UserIcon className="size-4 text-stone-400" />} placeholder="例如：admin" autoComplete="username" />
                    </Form.Item>

                    <Form.Item name="displayName" label="显示昵称（选填）">
                        <Input prefix={<Smile className="size-4 text-stone-400" />} placeholder="例如：超级管理员" />
                    </Form.Item>

                    <Form.Item
                        name="password"
                        label="登录密码"
                        rules={[
                            { required: true, message: "请输入登录密码" },
                            { min: 6, message: "密码长度不能少于 6 位" },
                        ]}
                    >
                        <Input.Password prefix={<Lock className="size-4 text-stone-400" />} placeholder="至少 6 位字符" autoComplete="new-password" />
                    </Form.Item>

                    <Form.Item
                        name="confirmPassword"
                        label="确认密码"
                        dependencies={["password"]}
                        rules={[
                            { required: true, message: "请再次输入密码" },
                            ({ getFieldValue }) => ({
                                validator(_, value) {
                                    if (!value || getFieldValue("password") === value) {
                                        return Promise.resolve();
                                    }
                                    return Promise.reject(new Error("两次输入的密码不一致"));
                                },
                            }),
                        ]}
                    >
                        <Input.Password prefix={<Lock className="size-4 text-stone-400" />} placeholder="再次输入密码确认" autoComplete="new-password" />
                    </Form.Item>

                    <Form.Item className="mb-0 mt-6">
                        <Button type="primary" htmlType="submit" block loading={submitting}>
                            完成初始化并进入系统
                        </Button>
                    </Form.Item>
                </Form>
            </div>
        </main>
    );
}
