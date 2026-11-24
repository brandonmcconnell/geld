import type * as React from "react";

import { cn } from "../lib/utils";

// Mirrors assets/brand/geld-logomark.svg, drawn in the text colour.
const LOGOMARK =
	"M24 0H6L0 6V25H18L24 19V7H9L7 9V18H15L17 16V14H11V11H20V17L16 21H4V8L8 4H24Z";

function Logo({
	className,
	variant = "default",
	...props
}: React.ComponentProps<"svg"> & { variant?: "default" | "dev" }) {
	return (
		<svg
			data-slot="logo"
			viewBox="0 0 24 25"
			fill="currentColor"
			aria-hidden="true"
			className={cn(
				"size-10 shrink-0",
				variant === "dev" && "text-brand-dev",
				className,
			)}
			{...props}
		>
			<path d={LOGOMARK} />
		</svg>
	);
}

export { Logo };
