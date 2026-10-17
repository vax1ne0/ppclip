import { useEffect, useState, type RefObject } from "react";

/** True once the element has been on screen (no observer, e.g. tests: immediately). */
export function useSeen(ref: RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver !== "function");
  useEffect(() => {
    if (seen || !ref.current || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, seen]);
  return seen;
}
