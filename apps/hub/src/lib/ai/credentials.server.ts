import "@tanstack/react-start/server-only";
import { platform } from "#/platform";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
	const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

export function canSealCredentials(): boolean {
	return (platform.config().TOKEN_ENCRYPTION_KEY ?? "").length >= 32;
}

async function encryptionKey(): Promise<CryptoKey> {
	const secret = platform.config().TOKEN_ENCRYPTION_KEY ?? "";
	if (secret.length < 32) {
		throw new Error("Credential encryption is not configured");
	}
	return crypto.subtle.importKey(
		"raw",
		await crypto.subtle.digest("SHA-256", encoder.encode(secret)),
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);
}

// Must stay byte for byte what `apps/dashboard/lib/crypto.ts` writes and reads: both apps open one table's keys.
export async function sealCredential(value: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await encryptionKey(),
		encoder.encode(value),
	);
	return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openCredential(value: string): Promise<string | null> {
	const [version, ivText, ciphertextText, ...rest] = value.split(".");
	if (version !== "v1" || !ivText || !ciphertextText || rest.length > 0) {
		return null;
	}
	try {
		const iv = fromBase64Url(ivText);
		if (iv.length !== 12) return null;
		return new TextDecoder().decode(
			await crypto.subtle.decrypt(
				{ name: "AES-GCM", iv },
				await encryptionKey(),
				fromBase64Url(ciphertextText),
			),
		);
	} catch {
		return null;
	}
}
