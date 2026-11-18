import type { faCircle } from "@awesome.me/kit-2e791c163e/icons/sharp/regular";
import { forwardRef, type SVGProps } from "react";

type IconDefinition = typeof faCircle;

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children" | "viewBox"> & {
  size?: number | string;
  /** Accepted so stroke-icon call sites keep working; these glyphs are filled. */
  strokeWidth?: number | string;
};

// Glyphs fill their box edge to edge; this margin gives them the optical size
// of an icon drawn on a padded grid, so `size` means the same everywhere.
const MARGIN = 0.07;

/** A Font Awesome Sharp glyph from the Geld kit, drawn inline in the text colour. */
export function createIcon(definition: IconDefinition, displayName: string) {
  const [width, height, , , data] = definition.icon;
  const paths = typeof data === "string" ? [data] : data;
  const side = Math.max(width, height) * (1 + MARGIN * 2);
  const viewBox = `${(width - side) / 2} ${(height - side) / 2} ${side} ${side}`;

  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
    { size = 24, strokeWidth: _strokeWidth, width: w, height: h, ...rest },
    ref
  ) {
    const labelled = rest["aria-label"] !== undefined;
    return (
      <svg
        aria-hidden={labelled ? undefined : true}
        fill="currentColor"
        focusable="false"
        height={h ?? size}
        ref={ref}
        role={labelled ? "img" : undefined}
        viewBox={viewBox}
        width={w ?? size}
        xmlns="http://www.w3.org/2000/svg"
        {...rest}
      >
        {paths.map((d) => (
          <path d={d} key={d} />
        ))}
      </svg>
    );
  });
  Icon.displayName = displayName;
  return Icon;
}
