import { apiClient } from "./client";

export type SystemStats = {
    userCount: number;
    activeUserCount?: number;
    projectCount: number;
    assetCount: number;
    storageBytes: number;
};

export type AdminUserItem = {
    id: string;
    username: string;
    displayName?: string | null;
    role: "admin" | "user";
    status: "active" | "disabled";
    createdAt: string;
    updatedAt: string;
};

export type UserListParams = {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc" | "ASC" | "DESC";
};

export type UserListResponse = {
    users: AdminUserItem[];
    total: number;
    page?: number;
    limit?: number;
};

export type CreateUserPayload = {
    username: string;
    password: string;
    displayName?: string;
    role?: "admin" | "user";
};

export type CreateUserResponse = {
    success: boolean;
    user: AdminUserItem;
};

export type UpdateUserStatusPayload = {
    status: "active" | "disabled";
};

export type UpdateUserStatusResponse = {
    success: boolean;
    user: AdminUserItem;
};

export type ResetPasswordPayload = {
    newPassword: string;
};

export type ResetPasswordResponse = {
    success: boolean;
    message?: string;
};

export type DeleteUserResponse = {
    success: boolean;
    message?: string;
};

export type AiConfig = {
    baseUrl: string;
    apiKeyMasked?: string;
    hasKey?: boolean;
    hasApiKey?: boolean;
    imageModels: string[];
    defaultModel: string;
    chatModels?: string[];
    timeoutMs?: number;
    customHeaders?: Record<string, string>;
};

export type UpdateAiConfigPayload = {
    baseUrl: string;
    apiKey?: string;
    imageModels: string[];
    defaultModel: string;
    chatModels?: string[];
    timeoutMs?: number;
    customHeaders?: Record<string, string>;
};

export type UpdateAiConfigResponse = {
    success: boolean;
    message?: string;
};

export type TestAiConfigPayload = {
    baseUrl?: string;
    apiKey?: string;
};

export type TestAiConfigResponse = {
    success: boolean;
    latencyMs?: number;
    message?: string;
};

export type FetchModelsPayload = {
    baseUrl?: string;
    apiKey?: string;
};

export type FetchModelsResponse = {
    success: boolean;
    total: number;
    imageModels: string[];
    chatModels: string[];
    otherModels: string[];
    allModels: string[];
    latencyMs?: number;
    status?: number;
    message?: string;
};

export async function getAdminStats(): Promise<SystemStats> {
    const { data } = await apiClient.get<SystemStats>("/admin/stats");
    return data;
}

export async function getAdminUsers(params?: UserListParams): Promise<UserListResponse> {
    const { data } = await apiClient.get<UserListResponse>("/admin/users", { params });
    return data;
}

export async function createAdminUser(payload: CreateUserPayload): Promise<CreateUserResponse> {
    const { data } = await apiClient.post<CreateUserResponse>("/admin/users", payload);
    return data;
}

export async function updateAdminUserStatus(id: string, payload: UpdateUserStatusPayload): Promise<UpdateUserStatusResponse> {
    const { data } = await apiClient.patch<UpdateUserStatusResponse>(`/admin/users/${id}/status`, payload);
    return data;
}

export async function resetAdminUserPassword(id: string, payload: ResetPasswordPayload): Promise<ResetPasswordResponse> {
    const { data } = await apiClient.post<ResetPasswordResponse>(`/admin/users/${id}/reset-password`, payload);
    return data;
}

export async function deleteAdminUser(id: string): Promise<DeleteUserResponse> {
    const { data } = await apiClient.delete<DeleteUserResponse>(`/admin/users/${id}`);
    return data;
}

export async function getAdminAiConfig(): Promise<AiConfig> {
    const { data } = await apiClient.get<AiConfig>("/admin/ai-config");
    return data;
}

export async function updateAdminAiConfig(payload: UpdateAiConfigPayload): Promise<UpdateAiConfigResponse> {
    const { data } = await apiClient.put<UpdateAiConfigResponse>("/admin/ai-config", payload);
    return data;
}

export async function testAdminAiConfig(payload: TestAiConfigPayload): Promise<TestAiConfigResponse> {
    const { data } = await apiClient.post<TestAiConfigResponse>("/admin/ai-config/test", payload);
    return data;
}

export async function fetchAdminUpstreamModels(payload: FetchModelsPayload): Promise<FetchModelsResponse> {
    const { data } = await apiClient.post<FetchModelsResponse>("/admin/ai-config/fetch-models", payload);
    return data;
}
