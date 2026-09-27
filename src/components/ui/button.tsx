import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#056FEC] hover:bg-[#043FAD] text-white shadow-xs font-semibold",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 font-semibold",
        outline:
          "border border-border/80 bg-background shadow-xs hover:bg-muted/50 hover:text-foreground font-medium",
        secondary: "bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white shadow-xs font-semibold",
        orange: "bg-[#FF7F1C] hover:bg-[#FF7F1C]/90 text-white shadow-xs font-semibold",
        ghost: "hover:bg-muted/50 hover:text-foreground font-medium",
        link: "text-[#056FEC] dark:text-[#05ACFF] underline-offset-4 hover:underline font-semibold",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
