import { useState } from "react";
import { Modal, Form, Input, Select } from "antd";
import { User, Lock, Smile } from "lucide-react";
import type { CreateUserPayload } from "@/services/api/admin";

type AdminUserModalProps = {
    open: boolean;
    onCancel: () => void;
    onSubmit: (payload: CreateUserPayload) => Promise<boolean>;
};

export function AdminUserModal({ open, onCancel, onSubmit }: AdminUserModalProps) {
    const [form] = Form.useForm();
    const [submitting, setSubmitting] = useState(false);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            setSubmitting(true);
            const success = await onSubmit({
                username: values.username.trim(),
                password: values.password,
                displayName: values.displayName?.trim() || undefined,
                role: values.role || "user",
            });
            if (success) {
                form.resetFields();
                onCancel();
            }
        } catch {
            // Form validation error
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            title="添加新用户"
            open={open}
            onCancel={() => {
                form.resetFields();
                onCancel();
            }}
            onOk={handleOk}
            confirmLoading={submitting}
            okText="创建用户"
            cancelText="取消"
            destroyOnClose
        >
            <Form
                form={form}
                layout="vertical"
                initialValues={{ role: "user" }}
                requiredMark={false}
                className="mt-4"
            >
                <Form.Item
                    name="username"
                    label="账号用户名"
                    rules={[
                        { required: true, message: "请输入用户名" },
                        { min: 2, max: 32, message: "长度在 2-32 个字符之间" },
                        { pattern: /^[a-zA-Z0-9_-]+$/, message: "仅支持英文字母、数字、下划线及连字符" },
                    ]}
                >
                    <Input prefix={<User className="size-4 text-stone-400" />} placeholder="例如：designer_01" autoComplete="off" />
                </Form.Item>

                <Form.Item name="displayName" label="显示昵称（选填）">
                    <Input prefix={<Smile className="size-4 text-stone-400" />} placeholder="例如：视觉设计师" />
                </Form.Item>

                <Form.Item
                    name="password"
                    label="登录密码"
                    rules={[
                        { required: true, message: "请输入初始密码" },
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

                <Form.Item name="role" label="用户权限角色">
                    <Select
                        options={[
                            { label: "普通用户 (user)", value: "user" },
                            { label: "系统管理员 (admin)", value: "admin" },
                        ]}
                    />
                </Form.Item>
            </Form>
        </Modal>
    );
}
