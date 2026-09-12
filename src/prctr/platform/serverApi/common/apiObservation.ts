export interface ApiSubscription {
	dispose(): void;
}
export interface ObservableApiCapability<I, R> {
	observe?(intent: I, listener: (response: R) => void): ApiSubscription;
}
