import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  className?: string;
  title?: string;
  actions?: React.ReactNode;
}

export function Card({ children, className, title, actions }: Props) {
  return (
    <section className={cn("panel", className)}>
      {(title || actions) && (
        <header className="px-4 py-3 border-b border-line flex items-center justify-between">
          {title && <h3 className="text-base font-semibold tracking-tight text-ink">{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
