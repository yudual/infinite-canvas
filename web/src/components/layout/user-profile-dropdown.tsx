import { Avatar, Dropdown, type MenuProps, Tag } from "antd";
import { LogOut, Shield, User, LayoutDashboard, FolderOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useUserStore } from "@/stores/use-user-store";

interface UserProfileDropdownProps {
    onOpenProjects?: () => void;
}

export function UserProfileDropdown({ onOpenProjects }: UserProfileDropdownProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user, logout } = useUserStore();

    if (!user) return null;

    const isAdmin = user.role === "admin";
    const initial = (user.displayName || user.username || "U").slice(0, 1).toUpperCase();

    const handleLogout = async () => {
        await logout();
        navigate("/login", { replace: true });
    };

    const items: MenuProps["items"] = [
        {
            key: "user-info",
            disabled: true,
            label: (
                <div className="flex flex-col gap-1 py-1 px-1 min-w-40 text-stone-900 dark:text-stone-100">
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm truncate">{user.displayName || user.username}</span>
                        <Tag color={isAdmin ? "purple" : "blue"} className="!mr-0 text-xs">
                            {isAdmin ? "管理员" : "用户"}
                        </Tag>
                    </div>
                    <span className="text-xs text-stone-500 truncate">@{user.username}</span>
                </div>
            ),
        },
        {
            type: "divider",
        },
        ...(isAdmin
            ? [
                  {
                      key: "admin-dashboard",
                      icon: <Shield className="size-4 text-purple-500" />,
                      label: "管理后台",
                      onClick: () => navigate("/admin"),
                  },
              ]
            : []),
        {
            key: "cloud-projects",
            icon: <FolderOpen className="size-4 text-amber-500" />,
            label: "云端工程",
            onClick: () => {
                if (onOpenProjects) {
                    onOpenProjects();
                } else {
                    navigate("/canvas");
                }
            },
        },
        {
            type: "divider",
        },
        {
            key: "logout",
            danger: true,
            icon: <LogOut className="size-4" />,
            label: "退出登录",
            onClick: handleLogout,
        },
    ];

    return (
        <Dropdown menu={{ items }} placement="bottomRight" trigger={["click"]}>
            <button
                type="button"
                className="inline-flex h-8 items-center gap-2 rounded-full px-2 text-stone-700 transition hover:bg-black/5 dark:text-stone-200 dark:hover:bg-white/10"
                aria-label="User Profile"
            >
                <Avatar
                    size={26}
                    className="bg-stone-800 text-xs font-semibold text-white dark:bg-stone-200 dark:text-stone-900"
                >
                    {initial}
                </Avatar>
                <span className="max-w-24 truncate text-xs font-medium hidden sm:inline-block">
                    {user.displayName || user.username}
                </span>
            </button>
        </Dropdown>
    );
}
