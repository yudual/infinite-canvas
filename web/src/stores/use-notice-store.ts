import { create } from "zustand";
import { getPublicNotice, type SystemNoticeConfig } from "@/services/api/admin";

const NOTICE_STORAGE_KEY = "infinite-canvas:notice_dismiss_date_v2";

function getTodayString(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type NoticeStore = {
    notice: SystemNoticeConfig | null;
    loading: boolean;
    open: boolean;
    hasCheckedToday: boolean;
    fetchNotice: () => Promise<SystemNoticeConfig | null>;
    openNotice: () => void;
    closeNotice: (dontShowToday?: boolean) => void;
    checkAutoOpen: () => Promise<void>;
};

export const useNoticeStore = create<NoticeStore>((set, get) => ({
    notice: null,
    loading: false,
    open: false,
    hasCheckedToday: false,
    fetchNotice: async () => {
        try {
            set({ loading: true });
            const res = await getPublicNotice();
            if (res.success && res.notice) {
                set({ notice: res.notice, loading: false });
                return res.notice;
            }
        } catch (err) {
            console.warn("Failed to fetch public notice:", err);
        } finally {
            set({ loading: false });
        }
        return get().notice;
    },
    openNotice: () => {
        const currentNotice = get().notice;
        if (!currentNotice) {
            void get().fetchNotice().then(() => {
                set({ open: true });
            });
        } else {
            set({ open: true });
        }
    },
    closeNotice: (dontShowToday = false) => {
        const notice = get().notice;
        if (dontShowToday && notice) {
            try {
                const today = getTodayString();
                localStorage.setItem(NOTICE_STORAGE_KEY, `${today}:${notice.updatedAt || ""}`);
            } catch {}
            set({ hasCheckedToday: true, open: false });
        } else {
            set({ open: false });
        }
    },
    checkAutoOpen: async () => {
        const notice = await get().fetchNotice();
        if (!notice || !notice.enabled) {
            set({ hasCheckedToday: true, open: false });
            return;
        }

        const today = getTodayString();
        let isDismissed = false;
        try {
            const dismissed = localStorage.getItem(NOTICE_STORAGE_KEY);
            if (dismissed) {
                const [dismissedDate, dismissedUpdatedAt] = dismissed.split(":");
                isDismissed = dismissedDate === today && (!notice.updatedAt || dismissedUpdatedAt === notice.updatedAt);
            }
        } catch {}

        set({ hasCheckedToday: isDismissed });
        if (!isDismissed) {
            setTimeout(() => {
                set({ open: true });
            }, 600);
        }
    },
}));
