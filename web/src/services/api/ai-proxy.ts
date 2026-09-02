import { nanoid } from "nanoid";
import { apiClient } from "./client";
import { useUserStore } from "@/stores/use-user-store";

export interface AvailableModelsResponse {
    imageModels: string[];
    defaultModel?: string;
    defaultImageModel?: string;
    chatModels?: string[];
}

export interface ProxyGenerateImageParams {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    n?: number;
    background?: string;
    response_format?: "url" | "b64_json";
    signal?: AbortSignal;
}

export interface ProxyEditImageParams {
    prompt: string;
    image: string | File;
    mask?: string | File;
    model?: string;
    size?: string;
    quality?: string;
    n?: number;
    background?: string;
    signal?: AbortSignal;
}

export interface ProxyChatMessage {
    role: "system" | "user" | "assistant" | string;
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export interface ProxyImageItem {
    url?: string;
    b64_json?: string;
    b64?: string;
    base64?: string;
    image?: string;
    revised_prompt?: string;
}

export interface ProxyImageResponse {
    created?: number;
    data?: ProxyImageItem[];
    images?: ProxyImageItem[];
    results?: ProxyImageItem[];
}

export interface GeneratedImageResult {
    id: string;
    dataUrl: string;
    revisedPrompt?: string;
}

function parseProxyImageData(data: ProxyImageItem[]): GeneratedImageResult[] {
    const results: GeneratedImageResult[] = [];
    for (const item of data || []) {
        let dataUrl = "";
        const b64 = item.b64_json || item.b64 || item.base64 || item.image;
        if (typeof b64 === "string" && b64) {
            dataUrl = b64.startsWith("data:")
                ? b64
                : `data:image/png;base64,${b64}`;
        } else if (item.url) {
            dataUrl = item.url;
        }
        if (dataUrl) {
            results.push({ id: nanoid(), dataUrl, revisedPrompt: item.revised_prompt });
        }
    }
    return results;
}

/**
 * Fetch available image and chat models from the server AI proxy.
 * GET /api/ai/models
 */
export async function getAvailableModels(): Promise<AvailableModelsResponse> {
    const response = await apiClient.get<AvailableModelsResponse>("/ai/models");
    return {
        imageModels: response.data.imageModels || [],
        defaultModel: response.data.defaultModel || response.data.defaultImageModel,
        defaultImageModel: response.data.defaultImageModel || response.data.defaultModel,
        chatModels: response.data.chatModels || [],
    };
}

/**
 * Forward image generation request to the secure backend proxy.
 * POST /api/ai/images/generations
 */
export async function proxyGenerateImage(params: ProxyGenerateImageParams): Promise<GeneratedImageResult[]> {
    const { signal, ...body } = params;
    const response = await apiClient.post<ProxyImageResponse>("/ai/images/generations", body, {
        signal,
        timeout: 300000,
    });
    const items = response.data.data || response.data.images || response.data.results || [];
    const images = parseProxyImageData(items);
    if (!images.length) {
        throw new Error("No image returned from AI proxy");
    }
    return images;
}

/**
 * Forward image editing / inpainting request to the secure backend proxy.
 * POST /api/ai/images/edits
 */
export async function proxyEditImage(
    input: FormData | ProxyEditImageParams,
    options?: { signal?: AbortSignal },
): Promise<GeneratedImageResult[]> {
    let response: { data: ProxyImageResponse };

    if (input instanceof FormData) {
        response = await apiClient.post<ProxyImageResponse>("/ai/images/edits", input, {
            headers: { "Content-Type": "multipart/form-data" },
            signal: options?.signal,
            timeout: 300000,
        });
    } else {
        const { signal, ...body } = input;
        response = await apiClient.post<ProxyImageResponse>("/ai/images/edits", body, {
            signal: signal || options?.signal,
            timeout: 300000,
        });
    }

    const items = response.data.data || response.data.images || response.data.results || [];
    const images = parseProxyImageData(items);
    if (!images.length) {
        throw new Error("No image returned from AI proxy edit");
    }
    return images;
}

/**
 * Forward chat completion request to the secure backend proxy with SSE streaming support.
 * POST /api/ai/chat/completions
 */
export async function proxyChatCompletion(
    messages: ProxyChatMessage[],
    onChunk?: (delta: string, accumulated: string) => void,
    signal?: AbortSignal,
    model?: string,
): Promise<string> {
    const token = useUserStore.getState().token || localStorage.getItem("token");

    // If streaming callback provided, use fetch with SSE stream reader
    if (onChunk) {
        const response = await fetch("/api/ai/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
                messages,
                model,
                stream: true,
            }),
            signal,
        });

        if (!response.ok) {
            let errorMsg = `AI chat request failed (HTTP ${response.status})`;
            try {
                const errData = await response.json();
                errorMsg = errData.message || errData.error?.message || errorMsg;
            } catch {}
            throw new Error(errorMsg);
        }

        if (!response.body) {
            return "";
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";

        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) continue;
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === "[DONE]") continue;

                try {
                    const parsed = JSON.parse(dataStr);
                    const delta =
                        parsed.choices?.[0]?.delta?.content ||
                        parsed.choices?.[0]?.delta?.text ||
                        "";
                    if (delta) {
                        accumulated += delta;
                        onChunk(delta, accumulated);
                    }
                } catch {
                    // Ignore non-json chunks or partial frames
                }
            }
        }

        return accumulated;
    }

    // Synchronous JSON response
    const response = await apiClient.post<{
        choices?: Array<{ message?: { content?: string } }>;
    }>(
        "/ai/chat/completions",
        {
            messages,
            model,
            stream: false,
        },
        { signal },
    );

    const content = response.data.choices?.[0]?.message?.content || "";
    return content;
}
