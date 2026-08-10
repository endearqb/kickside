import { useEffect } from "react";
import { loadPlatformCapabilities, usePlatformCapabilitiesStore } from "./platformStore";

export function usePlatformCapabilities() {
  const platform = usePlatformCapabilitiesStore();

  useEffect(() => {
    void loadPlatformCapabilities();
  }, []);

  return platform;
}
