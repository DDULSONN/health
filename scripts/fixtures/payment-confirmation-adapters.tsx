import React, { useMemo } from "react";
export function useSearchParams() { return useMemo(() => new URLSearchParams(window.location.search), []); }
export default function Link(props: React.ComponentProps<"a">) { return <a {...props} />; }
