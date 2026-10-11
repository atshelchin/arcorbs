/** A link that opens X with a post written and `url` attached. */
export function postOnX(text: string, url: string): string {
	return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// Some in-app browsers have no clipboard API; the old way still works there.
		const field = document.createElement('textarea');
		field.value = text;
		field.style.position = 'fixed';
		field.style.opacity = '0';
		document.body.appendChild(field);
		field.select();
		document.execCommand('copy');
		field.remove();
	}
}
