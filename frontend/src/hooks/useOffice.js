import { useEffect, useState } from "react";
import { officeAPI } from "@/lib/api";

/**
 * The office a person belongs to, if any.
 *
 * Home office used to be reachable only by opening the drawer and finding item
 * 31. It is a place you belong to, so both Home and You ask this question and
 * render the answer where it is useful. A failure is silent: not belonging to an
 * office is a normal state, and an unavailable office endpoint must not put an
 * error on the home screen.
 */
export function useOffice() {
  const [state, setState] = useState({ office: null, loading: true, error: false });

  useEffect(() => {
    let alive = true;
    officeAPI
      .mine()
      .then(({ data }) => {
        if (!alive) return;
        const office = (data?.offices || [])[0] || null;
        setState({ office, loading: false, error: false });
      })
      .catch(() => {
        if (alive) setState({ office: null, loading: false, error: true });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
