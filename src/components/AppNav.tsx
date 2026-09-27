import { Link, useRouter } from "@tanstack/react-router";
import { useAuth, ROLE_LABELS, type AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, KeyRound } from "lucide-react";
import { ISchoolLogo } from "@/components/ISchoolLogo";
import { BrandIcon, type BrandIconName } from "@/components/BrandIcon";
import { useOperationRequestsNotifications } from "@/hooks/useOperationRequestsNotifications";
import { useNavigationPermissions } from "@/hooks/useNavigationPermissions";
import { Badge } from "@/components/ui/badge";

type NavItem = {
  to: string;
  label: string;
  icon: BrandIconName;
};

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "home" },
  { to: "/lab-data", label: "Lab Data", icon: "module" },
  { to: "/lab-allocation", label: "Lab Allocation", icon: "process_on" },
  { to: "/operation-requests", label: "Operation Requests", icon: "flags" },
  { to: "/quality", label: "Quality", icon: "quiz" },
  { to: "/projects", label: "Projects", icon: "project" },
  { to: "/exports", label: "Exports", icon: "upload" },
  { to: "/timeline", label: "Timeline", icon: "meeting" },
  { to: "/catering", label: "Catering", icon: "meeting" },
  { to: "/budget", label: "Budget", icon: "checkmark" },
  { to: "/users", label: "Admin Control Panel", icon: "users" },
];

export function AppNav() {
  const { user, roles, signOut } = useAuth();
  const { unreadCount } = useOperationRequestsNotifications();
  const { isTabAllowed } = useNavigationPermissions();
  const router = useRouter();
  const items = NAV.filter((i) => isTabAllowed(i.to, roles));
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link to="/dashboard" className="flex items-center gap-2 hover:opacity-95 transition-opacity shrink-0">
          <ISchoolLogo variant="full" size="md" />
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto py-1 text-xs sm:text-sm no-scrollbar">
          {items.map((item) => {
            const isOpRequests = item.to === "/operation-requests";
            const showBadge = isOpRequests && unreadCount > 0;

            return (
              <Link
                key={item.to}
                to={item.to}
                preload={false}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:bg-muted/40 hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary relative group"
                activeProps={{ className: "active" }}
              >
                <BrandIcon name={item.icon} size={15} className="opacity-75 group-hover:opacity-100" />
                <span>{item.label}</span>
                {showBadge && (
                  <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[9px] font-black bg-rose-500 text-white shadow-xs animate-in zoom-in-50">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-9 gap-2 px-2 hover:bg-[#F7FAFF] dark:hover:bg-[#182245] text-[#1F2A55] dark:text-[#F7FAFF] border border-transparent hover:border-[#E6EDF1] dark:hover:border-[#182245]"
            >
              <Avatar className="h-7 w-7 ring-1 ring-[#056FEC]/30 bg-[#056FEC]/10 text-[#056FEC] font-bold">
                <AvatarFallback className="text-xs text-[#056FEC] dark:text-[#05ACFF] bg-[#056FEC]/10 dark:bg-[#05ACFF]/20 font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-xs font-medium md:inline">{user?.email}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-[#E6EDF1] dark:border-[#182245] bg-white dark:bg-[#1F2A55]">
            <DropdownMenuLabel>
              <div className="text-sm font-semibold text-[#1F2A55] dark:text-[#F7FAFF]">{user?.email}</div>
              <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-[#597587] dark:text-[#85A5B9]">
                {roles.length ? (
                  roles.map((r) => (
                    <span key={r} className="rounded bg-[#056FEC]/10 dark:bg-[#05ACFF]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#056FEC] dark:text-[#05ACFF]">
                      {ROLE_LABELS[r]}
                    </span>
                  ))
                ) : (
                  "No role assigned"
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.navigate({ to: "/reset-password" })}
              className="cursor-pointer text-xs focus:bg-[#F7FAFF] dark:focus:bg-[#182245] focus:text-[#056FEC]"
            >
              <KeyRound className="mr-2 h-4 w-4 text-[#597587]" /> Reset Password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await signOut();
                router.navigate({ to: "/auth", search: { connection: undefined }, replace: true });
              }}
              className="cursor-pointer text-xs text-[#DE1F1F] focus:bg-[#FFD1D1]/30 focus:text-[#DE1F1F]"
            >
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
