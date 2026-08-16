import { useEffect, useState } from "react";

/** False on the server and the first client paint so wallet UI can hydrate safely. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
