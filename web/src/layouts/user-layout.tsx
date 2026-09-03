import { useEffect, type ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { SystemNoticeModal } from "@/components/layout/system-notice-modal";
import { useNoticeStore } from "@/stores/use-notice-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const checkAutoOpen = useNoticeStore((state) => state.checkAutoOpen);

    useEffect(() => {
        checkAutoOpen();
    }, [checkAutoOpen]);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
            <SystemNoticeModal />
        </div>
    );
}
