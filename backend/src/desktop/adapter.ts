export type DesktopRequest = {
	action: string;
	window_id?: string | undefined;
	window_ref?: string | undefined;
	view?: 'controls' | 'skeleton' | undefined;
	root_snapshot?: string | undefined;
	root_element_id?: number | undefined;
	wait_condition?: 'present' | 'absent' | 'enabled' | 'disabled' | 'selected' | 'unselected' | undefined;
	query?: string | undefined;
	control_type?: string | undefined;
	max_elements?: number;
	max_depth?: number;
	max_chars?: number;
	snapshot?: string | undefined;
	element_id?: number | undefined;
	ref?: string | undefined;
	text?: string | undefined;
	direction?: string | undefined;
	expect_value?: string | undefined;
	timeout_ms?: number | undefined;
	text_offset?: number;
	text_length?: number;
	expected_version?: string | undefined;
	required_text?: string | undefined;
	context_chars?: number;
	queries?: string[];
	ignore_case?: boolean;
	workbook_name?: string;
	sheet?: string;
	range?: string;
	data?: (string | number | boolean | null)[][];
	mode?: 'values' | 'formulas';
	version?: string;
	offset?: number;
	page_size?: number;
	cell_chars?: number;
	require_empty?: boolean;
	match?: 'contains' | 'exact';
	look_in?: 'values' | 'formulas';
	case_sensitive?: boolean;
	expected_path?: string;
};

export type DesktopRequestOptions = {signal?: AbortSignal | undefined; timeoutMs: number; paused: () => boolean; timeoutError: string};

/** Native execution boundary; specialized Course/Excel policy stays above the adapter. */
export type DesktopAdapter = {
	readonly platform: 'win32' | 'darwin' | 'linux';
	warm(): void;
	close(error?: Error): void;
	request(args: DesktopRequest, options?: DesktopRequestOptions): Promise<Record<string, unknown>>;
	requireForeground(windowId: string, options: DesktopRequestOptions, windowRef?: string): Promise<void>;
	assertControlLease(): void;
	withControlLease<T>(run: () => Promise<T>, signal?: AbortSignal, paused?: () => boolean, timeoutMs?: number): Promise<T>;
};
