import { CheckIcon } from "@geld/hub-icons";
import { cn } from "@geld/hub-ui/lib/utils";
import type { ActionStatus } from "./use-settings-action";

export function ActionNote({
	status,
	doneLabel = "Saved",
	className,
}: {
	status: ActionStatus;
	doneLabel?: string;
	className?: string;
}) {
	return (
		<output
			className={cn("flex min-w-0 items-center gap-1 text-xs", className)}
		>
			{status.kind === "done" ? (
				<span className="flex items-center gap-1 text-success">
					<CheckIcon size={12} strokeWidth={2.5} />
					{doneLabel}
				</span>
			) : null}
			{status.kind === "failed" ? (
				<span className="text-danger">{status.error}</span>
			) : null}
		</output>
	);
}
