import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";

const options = [
  { icon: Laptop, label: "System", value: "system" },
  { icon: Sun, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
] as const;

export function ModeToggle() {
  const { setTheme, theme } = useTheme();

  return (
    <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = theme === option.value;

        return (
          <Button
            aria-label={`Use ${option.label} theme`}
            className={isActive ? "bg-card shadow-sm" : "text-muted-foreground"}
            key={option.value}
            size="icon"
            title={option.label}
            type="button"
            variant="ghost"
            onClick={() => setTheme(option.value)}
          >
            <Icon />
          </Button>
        );
      })}
    </div>
  );
}
