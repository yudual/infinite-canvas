import { apiClient } from "./client";

export type UserRole = "admin" | "user";

export type User = {
    id: string;
    username: string;
    displayName?: string | null;
    role: UserRole;
    status?: "active" | "disabled";
    createdAt?: string;
    updatedAt?: string;
};

export type SetupStatusResponse = {
    initialized: boolean;
    requiresSetup: boolean;
};

export type InitSetupRequest = {
    username: string;
    password: string;
    displayName?: string;
    aiConfig?: {
        baseUrl?: string;
        apiKey?: string;
        imageModels?: string[];
        defaultModel?: string;
        chatModels?: string[];
    };
};

export type InitSetupResponse = {
    success: boolean;
    token: string;
    user: User;
};

export type LoginRequest = {
    username: string;
    password: string;
};

export type LoginResponse = {
    success?: boolean;
    token: string;
    user: User;
};

export type MeResponse = {
    success?: boolean;
    user: User;
};

export type LogoutResponse = {
    success: boolean;
};

export async function getSetupStatus(): Promise<SetupStatusResponse> {
    const { data } = await apiClient.get<SetupStatusResponse>("/setup/status");
    return data;
}

export async function initSetup(payload: InitSetupRequest): Promise<InitSetupResponse> {
    const { data } = await apiClient.post<InitSetupResponse>("/setup", payload);
    return data;
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
    const { data } = await apiClient.post<LoginResponse>("/auth/login", payload);
    return data;
}

export async function getMe(): Promise<MeResponse> {
    const { data } = await apiClient.get<MeResponse>("/auth/me");
    return data;
}

export async function logout(): Promise<LogoutResponse> {
    const { data } = await apiClient.post<LogoutResponse>("/auth/logout");
    return data;
}
