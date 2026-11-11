import "@tanstack/react-start/server-only";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { platform } from "#/platform";

const HEX = /^[0-9a-f]+$/i;

function looksSealed(value: string) {
	return (
		value.startsWith("$ba$") || (value.length % 2 === 0 && HEX.test(value))
	);
}

/**
 * Provider tokens in `identities` are encrypted with the auth secret, as
 * `account.encryptOAuthTokens` has Better Auth write them. Rows the hub
 * writes itself must be sealed the same way, or the dashboard, which shares
 * the table, could not read them.
 */
export function sealToken(value: string): Promise<string> {
	return symmetricEncrypt({
		key: platform.config().BETTER_AUTH_SECRET,
		data: value,
	});
}

export async function openToken(value: string | null): Promise<string | null> {
	if (!value) {
		return null;
	}
	if (!looksSealed(value)) {
		return value;
	}
	try {
		return await symmetricDecrypt({
			key: platform.config().BETTER_AUTH_SECRET,
			data: value,
		});
	} catch {
		return null;
	}
}
