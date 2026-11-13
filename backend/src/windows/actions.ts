/** The public native action contract shared by schemas and execution policy. */
export const windowsActionCatalog = {
	get_windows: {mutates: false, target: 'none'},
	get_ui: {mutates: false, target: 'window'},
	activate: {mutates: true, target: 'window'},
	invoke: {mutates: true, target: 'element'},
	set_value: {mutates: true, target: 'element'},
	select: {mutates: true, target: 'element'},
	toggle: {mutates: true, target: 'element'},
	expand: {mutates: true, target: 'element'},
	collapse: {mutates: true, target: 'element'},
	scroll: {mutates: true, target: 'element'},
	focus: {mutates: true, target: 'element'},
	read_text: {mutates: false, target: 'element'},
	wait_for: {mutates: false, target: 'window'},
	launch: {mutates: true, target: 'none'},
} as const;

export type WindowsAction = keyof typeof windowsActionCatalog;
export const windowsActions = Object.keys(windowsActionCatalog) as [WindowsAction, ...WindowsAction[]];

export function isReadOnlyNativeAction(action: string): boolean {
	if (Object.hasOwn(windowsActionCatalog, action)) {
		return !windowsActionCatalog[action as WindowsAction].mutates;
	}

	return ['status', 'acquire_control', 'release_control', 'wait_baseline', 'foreground', 'input_method', 'read_text_page', 'find_text_range', 'find_text_ranges', 'excel_inspect_workbook', 'excel_read_range', 'excel_find_cells', 'learning_encrypt_key', 'learning_decrypt_key'].includes(action);
}
