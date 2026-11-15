import { Link } from "@/i18n/navigation";
import { iconButtonClass } from "@/components/ui/button";
import { ChevronLeftIcon } from "@/components/ui/icons";

/** The round back button that leads from a More screen to /more. `label` names the target. */
export function BackLink({ label, href = "/more" }: { label: string; href?: string }) {
  return (
    <Link href={href} aria-label={label} title={label} className={iconButtonClass("filled", "-ml-1")}>
      <ChevronLeftIcon size={20} />
    </Link>
  );
}
