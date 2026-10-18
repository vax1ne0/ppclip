import { createContext, useContext, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const ActionHost = createContext<HTMLElement | null>(null);
const RegisterHost = createContext<Dispatch<SetStateAction<HTMLElement | null>> | null>(null);

/** The layout owns the dock; forms retain ownership of their actions and state. */
export function PageActionBarProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return <RegisterHost.Provider value={setHost}><ActionHost.Provider value={host}>{children}</ActionHost.Provider></RegisterHost.Provider>;
}
export function PageActionBarHost({ bottom }: { bottom?: string }) {
  const register = useContext(RegisterHost);
  return <div ref={register} style={{ bottom }} data-slot="page-action-dock" className="sticky bottom-0 z-20 shrink-0 border-t border-border bg-background px-4 empty:hidden md:static md:px-6" />;
}
export function PageActionBar({ children, className }: { children: ReactNode; className?: string }) {
  const host = useContext(ActionHost);
  const footer = <footer data-slot="page-action-bar" className={cn("mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 bg-background py-4", !host && "sticky bottom-0 z-10 border-t border-border", className)}>{children}</footer>;
  return host ? createPortal(footer, host) : footer;
}
