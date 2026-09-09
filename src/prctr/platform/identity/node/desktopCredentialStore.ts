export interface StoredDesktopSession {
	readonly version: 1;
	readonly phase: 'usable' | 'rotationPending';
	readonly origin: string;
	readonly institutionId: string;
	readonly installationId: string;
	readonly principalId: string;
	readonly sessionId: string;
	readonly registrationId: string;
	readonly keyThumbprint: string;
	readonly refreshToken: string;
	readonly refreshExpiresAt: number;
}
/** OS-encrypted credentials; access tokens are intentionally not accepted. */
export interface DesktopCredentialStore {
	read(scope: string): Promise<StoredDesktopSession | undefined>;
	write(scope: string, value: StoredDesktopSession): Promise<void>;
	delete(scope: string): Promise<void>;
}
