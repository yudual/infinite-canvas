import { useState, useEffect } from "react";
import { App, Button, Form, Input } from "antd";
import { Lock, User as UserIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { login } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

export default function LoginPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [submitting, setSubmitting] = useState(false);
    const { token, user, requiresSetup, loading, setSession } = useUserStore();

    const from = searchParams.get("from") || "/";

    useEffect(() => {
        if (loading) return;
        if (requiresSetup) {
            navigate("/setup", { replace: true });
            return;
        }
        if (token && user) {
            navigate(from, { replace: true });
        }
    }, [loading, requiresSetup, token, user, navigate, from]);

    const handleSubmit = async (values: { username: string; password: string }) => {
        try {
            setSubmitting(true);
            const res = await login({
                username: values.username.trim(),
                password: values.password,
            });
            message.success("登录成功");
            setSession(res.token, res.user);
            navigate(from, { replace: true });
        } catch (error: any) {
            const status = error.response?.status;
            if (status === 401) {
                message.error("用户名或密码错误");
            } else if (status === 403) {
                message.error("该账号已被禁用，请联系管理员");
            } else {
                const errorMsg = error.response?.data?.message || error.response?.data?.error?.message || error.message || "登录失败，请检查网络连接";
                message.error(errorMsg);
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="relative flex min-h-screen w-full items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] px-4 py-12 text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white/80 p-8 shadow-xl backdrop-blur-xl dark:border-stone-800 dark:bg-stone-900/80">
                <div className="mb-8 text-center">
                    <div
                        className="mx-auto mb-3 size-10 bg-current text-stone-950 dark:text-stone-100"
                        style={{
                            mask: "url(/logo.svg) center / contain no-repeat",
                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                        }}
                    />
                    <h1 className="text-2xl font-bold tracking-tight text-stone-950 dark:text-stone-100">登录 Yu-canvas</h1>
                    <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">欢迎回来，请登录您的工作台账户</p>
                </div>

                <Form layout="vertical" onFinish={handleSubmit} requiredMark={false} size="large">
                    <Form.Item name="username" label="账号" rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input prefix={<UserIcon className="size-4 text-stone-400" />} placeholder="用户名" autoComplete="username" />
                    </Form.Item>

                    <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password prefix={<Lock className="size-4 text-stone-400" />} placeholder="密码" autoComplete="current-password" />
                    </Form.Item>

                    <Form.Item className="mb-0 mt-6">
                        <Button type="primary" htmlType="submit" block loading={submitting}>
                            登 录
                        </Button>
                    </Form.Item>
                </Form>
            </div>
        </main>
    );
}
