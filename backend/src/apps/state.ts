export type AppState = 'ready' | 'auth_required' | 'unavailable' | 'layout_changed';
export type StateContract = {ready: string; auth: string; unavailable: string; origin: string};

/** Self-contained function, executed in the page without changing it. */
export function observeAppState(contract: StateContract): AppState {
	const visible = (selector: string) => Boolean(selector) && Array.from(document.querySelectorAll(selector)).some((element) => {
		const style = getComputedStyle(element);
		return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
	});
	if (location.origin !== contract.origin || visible(contract.auth)) {
		return 'auth_required';
	}

	if (visible(contract.unavailable)) {
		return 'unavailable';
	}

	return visible(contract.ready) ? 'ready' : 'layout_changed';
}
