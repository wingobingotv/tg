import { useEffect, useState } from "react"

/** Current time, re-read every `intervalMs` (one clock per screen, like the website's useSharedNow). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
