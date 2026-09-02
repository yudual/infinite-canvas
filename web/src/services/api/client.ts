import axios from "axios";
import { useUserStore } from "@/stores/use-user-store";

export const apiClient = axios.create({
    baseURL: "/api",
    timeout: 180000,
    headers: {
        "Content-Type": "application/json",
    },
});

apiClient.interceptors.request.use(
    (config) => {
        const token = useUserStore.getState().token || localStorage.getItem("token");
        if (token && config.headers) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error),
);

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            const url = error.config?.url || "";
            if (!url.includes("/auth/login") && !url.includes("/setup")) {
                useUserStore.getState().clearSession();
            }
        }
        return Promise.reject(error);
    },
);

export default apiClient;
