import type { ButtonHTMLAttributes } from "react";

import "./primitives.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "primary";
}

export function Button({ variant = "default", className, type = "button", ...rest }: ButtonProps) {
  const classes = ["button", variant !== "default" && `button--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}
