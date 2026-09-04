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

// ==========================================
// Channels API
// ==========================================

export type AdminChannelItem = {
    id: string;
    name: string;
    providerType: string;
    baseUrl: string;
    apiKeyMasked: string;
    hasApiKey: boolean;
    models: string[];
    defaultModel: string | null;
    priority: number;
    weight: number;
    isActive: boolean;
    timeoutMs: number;
    customHeaders: Record<string, string>;
    healthStatus: "healthy" | "degraded" | "unhealthy" | "unknown";
    lastLatencyMs: number | null;
    lastCheckedAt: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ChannelListParams = {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
};

export type ChannelListResponse = {
    success: boolean;
    channels: AdminChannelItem[];
    total: number;
    page: number;
    limit: number;
};

export type CreateChannelPayload = {
    name: string;
    providerType?: string;
    baseUrl: string;
    apiKey: string;
    models?: string[];
    defaultModel?: string;
    priority?: number;
    weight?: number;
    isActive?: boolean;
    timeoutMs?: number;
    customHeaders?: Record<string, string>;
};

export type UpdateChannelPayload = Partial<CreateChannelPayload>;

export async function getAdminChannels(params?: ChannelListParams): Promise<ChannelListResponse> {
    const { data } = await apiClient.get<ChannelListResponse>("/admin/channels", { params });
    return data;
}

export async function createAdminChannel(payload: CreateChannelPayload): Promise<{ success: boolean; channel: AdminChannelItem }> {
    const { data } = await apiClient.post("/admin/channels", payload);
    return data;
}

export async function updateAdminChannel(id: string, payload: UpdateChannelPayload): Promise<{ success: boolean; channel: AdminChannelItem }> {
    const { data } = await apiClient.put(`/admin/channels/${id}`, payload);
    return data;
}

export async function toggleAdminChannelStatus(id: string, isActive: boolean): Promise<{ success: boolean; channel: AdminChannelItem; isActive: boolean }> {
    const { data } = await apiClient.patch(`/admin/channels/${id}/status`, { isActive });
    return data;
}

export async function deleteAdminChannel(id: string): Promise<{ success: boolean; message: string }> {
    const { data } = await apiClient.delete(`/admin/channels/${id}`);
    return data;
}

export async function testAdminChannel(id: string): Promise<{ success: boolean; latencyMs: number; healthStatus: string; statusCode: number; message: string }> {
    const { data } = await apiClient.post(`/admin/channels/${id}/test`);
    return data;
}

export async function syncAdminChannelModels(id: string): Promise<{ success: boolean; latencyMs: number; total: number; imageModels: string[]; chatModels: string[]; otherModels: string[]; allModels: string[] }> {
    const { data } = await apiClient.post(`/admin/channels/${id}/sync-models`);
    return data;
}

// ==========================================
// Assets API
// ==========================================

export type AdminAssetItem = {
    id: string;
    userId: string | null;
    username: string | null;
    userDisplayName: string | null;
    filename: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminAssetStats = {
    totalAssetCount: number;
    totalStorageBytes: number;
    diskFileCount: number;
    diskBytes: number;
    imageCount: number;
    orphanCount: number;
    orphanBytes: number;
    orphanFiles: string[];
};

export type AssetListParams = {
    page?: number;
    limit?: number;
    search?: string;
    userId?: string;
    type?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc" | "ASC" | "DESC";
};

export type AssetListResponse = {
    success: boolean;
    assets: AdminAssetItem[];
    total: number;
    page: number;
    limit: number;
};

export async function getAdminAssetStats(): Promise<AdminAssetStats> {
    const { data } = await apiClient.get<AdminAssetStats>("/admin/assets/stats");
    return data;
}

export async function getAdminAssets(params?: AssetListParams): Promise<AssetListResponse> {
    const { data } = await apiClient.get<AssetListResponse>("/admin/assets", { params });
    return data;
}

export async function deleteAdminAsset(id: string): Promise<{ success: boolean; message: string }> {
    const { data } = await apiClient.delete(`/admin/assets/${id}`);
    return data;
}

export async function batchDeleteAdminAssets(ids: string[]): Promise<{ success: boolean; deletedCount: number; totalBytesFreed: number; message: string }> {
    const { data } = await apiClient.post("/admin/assets/batch-delete", { ids });
    return data;
}

export async function cleanupAdminOrphanAssets(): Promise<{ success: boolean; removedCount: number; totalBytesFreed: number; message: string }> {
    const { data } = await apiClient.post("/admin/assets/cleanup-orphans");
    return data;
}

// ==========================================
// Projects API
// ==========================================

export type AdminProjectItem = {
    id: string;
    userId: string;
    username: string | null;
    userDisplayName: string | null;
    name: string;
    description: string | null;
    canvasDataSize: number;
    createdAt: string;
    updatedAt: string;
};

export type ProjectListParams = {
    page?: number;
    limit?: number;
    search?: string;
    userId?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc" | "ASC" | "DESC";
};

export type ProjectListResponse = {
    success: boolean;
    projects: AdminProjectItem[];
    total: number;
    page: number;
    limit: number;
};

export async function getAdminProjects(params?: ProjectListParams): Promise<ProjectListResponse> {
    const { data } = await apiClient.get<ProjectListResponse>("/admin/projects", { params });
    return data;
}

export async function deleteAdminProject(id: string): Promise<{ success: boolean; message: string }> {
    const { data } = await apiClient.delete(`/admin/projects/${id}`);
    return data;
}

export async function batchDeleteAdminProjects(ids: string[]): Promise<{ success: boolean; deletedCount: number; message: string }> {
    const { data } = await apiClient.post("/admin/projects/batch-delete", { ids });
    return data;
}

export async function resetAdminProject(id: string): Promise<{ success: boolean; message: string }> {
    const { data } = await apiClient.post(`/admin/projects/${id}/reset`);
    return data;
}

// ==========================================
// Audit Logs API
// ==========================================

export type AdminAuditLogItem = {
    id: string;
    userId: string | null;
    username: string | null;
    requestType: "image_generation" | "image_edit" | "chat_completion";
    model: string;
    channelId: string | null;
    channelName: string | null;
    status: "success" | "failed";
    statusCode: number;
    durationMs: number;
    promptPreview: string | null;
    requestBody?: string | null;
    responseSummary?: string | null;
    errorMessage?: string | null;
    retryCount: number;
    ipAddress?: string | null;
    createdAt: string;
};

export type AuditLogListParams = {
    page?: number;
    limit?: number;
    status?: string;
    requestType?: string;
    model?: string;
    channelId?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
};

export type AuditLogListResponse = {
    success: boolean;
    logs: AdminAuditLogItem[];
    total: number;
    page: number;
    limit: number;
};

export async function getAdminAuditLogs(params?: AuditLogListParams): Promise<AuditLogListResponse> {
    const { data } = await apiClient.get<AuditLogListResponse>("/admin/audit-logs", { params });
    return data;
}

export async function getAdminAuditLogById(id: string): Promise<{ success: boolean; log: AdminAuditLogItem }> {
    const { data } = await apiClient.get<{ success: boolean; log: AdminAuditLogItem }>(`/admin/audit-logs/${id}`);
    return data;
}

// ==========================================
// System Announcement API
// ==========================================

export type NoticeItem = {
    id?: string;
    title: string;
    description: string;
    type: "info" | "warning" | "tip" | "error";
};

export type SystemNoticeConfig = {
    enabled: boolean;
    title: string;
    tag: string;
    tagColor: string;
    content: string;
    items: NoticeItem[];
    footerNote: string;
    updatedAt: string;
};

export async function getAdminNotice(): Promise<{ success: boolean; notice: SystemNoticeConfig }> {
    const { data } = await apiClient.get<{ success: boolean; notice: SystemNoticeConfig }>("/admin/notice");
    return data;
}

export async function updateAdminNotice(config: Partial<SystemNoticeConfig>): Promise<{ success: boolean; notice: SystemNoticeConfig; message: string }> {
    const { data } = await apiClient.put<{ success: boolean; notice: SystemNoticeConfig; message: string }>("/admin/notice", config);
    return data;
}

export async function getPublicNotice(): Promise<{ success: boolean; notice: SystemNoticeConfig }> {
    const { data } = await apiClient.get<{ success: boolean; notice: SystemNoticeConfig }>("/notice");
    return data;
}

