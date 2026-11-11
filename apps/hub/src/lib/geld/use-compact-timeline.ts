import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "geld-hub:timeline";
const listeners = new Set<() => void>();

function read(): boolean {
	try {
		return window.localStorage.getItem(STORAGE_KEY) !== "full";
	} catch {
		return true;
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useCompactTimeline(): [boolean, (compact: boolean) => void] {
	const compact = useSyncExternalStore(subscribe, read, () => true);
	const setCompact = useCallback((next: boolean) => {
		try {
			window.localStorage.setItem(STORAGE_KEY, next ? "compact" : "full");
		} catch {}
		for (const listener of listeners) listener();
	}, []);
	return [compact, setCompact];
}
