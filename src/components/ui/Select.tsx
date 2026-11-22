"use client";

import { SelectHTMLAttributes } from "react";
import clsx from "clsx";

/**
 * Wraps a native <select> with the same animated gold-top/green-bottom line
 * used on every Panel (see globals.css's .panel::before/::after) — a plain
 * <select> can't carry that itself since browsers don't render ::before/
 * ::after on replaced form elements. Also fixes the dropdown popup's
 * contrast: without an explicit color-scheme + option background/color, some
 * browsers (Firefox in particular) render the popup list with the OS-default
 * light background while still inheriting the app's light --text color,
 * producing barely-readable light-on-light text.
 *
 * className here sizes the WRAPPER (e.g. "w-48", "sm:col-span-2") — the
 * select itself always fills it via field-input's width:100%.
 */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={clsx("select-wrap", className)}>
      <select className="field-input" {...props} />
    </div>
  );
}
