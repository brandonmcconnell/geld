'use client';
import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { magicLinkClient } from 'better-auth/client/plugins';
export const authClient = createAuthClient({ plugins: [emailOTPClient(), magicLinkClient()] });
