import apiClient from "./client";

export interface CloudProjectListItem {
    id: string;
    name: string;
    thumbnail: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CloudProjectDetail {
    id: string;
    name: string;
    canvasData: any;
    thumbnail: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CloudAssetItem {
    id: string;
    url: string;
    filename: string;
    originalName: string | null;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
}

export async function fetchProjects(params?: { page?: number; limit?: number; search?: string }): Promise<{ projects: CloudProjectListItem[]; total: number }> {
    const res = await apiClient.get("/projects", { params });
    return res.data;
}

export async function createProject(data: { name: string; canvasData: any; thumbnail?: string }): Promise<CloudProjectDetail> {
    const res = await apiClient.post("/projects", data);
    return res.data.project;
}

export async function fetchProjectById(id: string): Promise<CloudProjectDetail> {
    const res = await apiClient.get(`/projects/${id}`);
    return res.data.project;
}

export async function updateProject(id: string, data: { name?: string; canvasData?: any; thumbnail?: string }): Promise<CloudProjectDetail> {
    const res = await apiClient.put(`/projects/${id}`, data);
    return res.data.project;
}

export async function deleteProject(id: string): Promise<boolean> {
    const res = await apiClient.delete(`/projects/${id}`);
    return res.data.success;
}

export async function uploadAsset(file: File): Promise<CloudAssetItem> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiClient.post("/assets/upload", formData, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
    });
    return res.data.asset || res.data;
}

export async function fetchAssets(params?: { page?: number; limit?: number }): Promise<{ assets: CloudAssetItem[]; total: number }> {
    const res = await apiClient.get("/assets", { params });
    return res.data;
}

export async function deleteAsset(id: string): Promise<boolean> {
    const res = await apiClient.delete(`/assets/${id}`);
    return res.data.success;
}
