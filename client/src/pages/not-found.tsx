import { Link } from "wouter";
import { DetourLogo } from "@/components/kit";

export default function NotFound() {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-6 text-center">
      <div className="max-w-sm space-y-5">
        <DetourLogo className="mx-auto h-10 text-foreground" />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">You've taken a wrong turn</h1>
          <p className="text-muted-foreground">This page doesn't exist. Head back to the map and find a park instead.</p>
        </div>
        <Link href="/" className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-[15px] font-semibold text-primary-foreground">
          Back to the map
        </Link>
      </div>
    </div>
  );
}
