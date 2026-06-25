// Smallest changed span between two strings: skip the common prefix and common
// suffix, return [start, end] offsets INTO `next`. Used to highlight exactly what
// an "Apply to script" refine edit touched, so the user can see the change.
// Falls back to the whole of `next` on a full rewrite. end ≥ start always.
export function changedRange(prev: string, next: string): [number, number] {
	const max = Math.min(prev.length, next.length);
	let p = 0;
	while (p < max && prev[p] === next[p]) p++;
	let s = 0;
	while (s < max - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
	return [p, Math.max(p, next.length - s)];
}
