import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { cn } from "../../utils/cn";

export interface BookmarkTab {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

/**
 * Tabs styled like folder bookmarks / file tabs: each trigger has rounded top
 * corners and side+top borders, sitting on a hairline; the active tab rises
 * above the line (z-10) and joins the panel beneath it.
 */
export function BookmarkTabs({
  tabs,
  value,
  onValueChange,
  className,
  contentClassName,
}: {
  tabs: BookmarkTab[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={className}>
      <TabsList className="relative h-auto w-full gap-0.5 bg-transparent p-0 before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="flex-1 overflow-hidden rounded-b-none rounded-t-md border-x border-t border-border bg-muted py-2 text-xs font-semibold tracking-wide transition-colors data-[state=active]:z-10 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent
          key={t.value}
          value={t.value}
          className={cn(
            "mt-0 animate-[tp-tab-in_0.18s_ease] rounded-b-lg border border-t-0 border-border bg-card",
            contentClassName,
          )}
        >
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
