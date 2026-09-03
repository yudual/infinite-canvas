import { create } from "zustand";

const NOTICE_STORAGE_KEY = "infinite-canvas:notice_dismiss_date_v1";

function getTodayString(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type NoticeStore = {
    open: boolean;
    hasCheckedToday: boolean;
    openNotice: () => void;
    closeNotice: (dontShowToday?: boolean) => void;
    checkAutoOpen: () => void;
};

export const useNoticeStore = create<NoticeStore>((set) => ({
    open: false,
    hasCheckedToday: false,
    openNotice: () => set({ open: true }),
    closeNotice: (dontShowToday = false) => {
        if (dontShowToday) {
            try {
                localStorage.setItem(NOTICE_STORAGE_KEY, getTodayString());
            } catch {}
            set({ hasCheckedToday: true, open: false });
        } else {
            set({ open: false });
        }
    },
    checkAutoOpen: () => {
        const today = getTodayString();
        let isDismissed = false;
        try {
            const dismissed = localStorage.getItem(NOTICE_STORAGE_KEY);
            isDismissed = dismissed === today;
        } catch {}

        set({ hasCheckedToday: isDismissed });
        if (!isDismissed) {
            setTimeout(() => {
                set({ open: true });
            }, 600);
        }
    },
}));
