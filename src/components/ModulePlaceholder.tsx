import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BrandIcon } from "@/components/BrandIcon";

export function ModulePlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <BrandIcon name="module" size={24} />
            {title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge className="bg-[#056FEC]/10 text-[#056FEC] border border-[#056FEC]/25">{phase}</Badge>
      </div>
      <Card className="border border-[#E6EDF1] dark:border-[#1F2A55] shadow-xs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-[#1F2A55] dark:text-[#F7FAFF]">
            <BrandIcon name="inprogress" size={18} />
            Module Deployment Phase
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This module is integrated into the iSchool B2G management lifecycle. Auth, telemetry, and the app shell are ready.
        </CardContent>
      </Card>
    </div>
  );
}
